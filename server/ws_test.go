package server

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"

	"go-poc/db"
	"go-poc/engine"
	"go-poc/models"
)

// dialWS serves a Server's websocket and connects to it.
func dialWS(t *testing.T) *websocket.Conn {
	t.Helper()
	if db.DB == nil {
		// every request looks up its user
		mem, err := sql.Open("sqlite", ":memory:")
		if err != nil {
			t.Fatal(err)
		}
		db.DB = mem
		t.Cleanup(func() {
			db.DB = nil
			mem.Close()
		})
	}
	s := &Server{clients: map[*websocket.Conn]bool{}, mutex: &sync.Mutex{}}
	srv := httptest.NewServer(http.HandlerFunc(s.wsHandler))
	t.Cleanup(srv.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func readReply(t *testing.T, conn *websocket.Conn) PayloadResponse {
	t.Helper()
	var res PayloadResponse
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := conn.ReadJSON(&res); err != nil {
		t.Fatal(err)
	}
	return res
}

func TestSlowRequestDoesNotBlockLaterOnes(t *testing.T) {
	release := make(chan struct{})
	routes["test-slow"] = func(c *websocket.Conn, req PayloadRequest) {
		<-release
		transmitPromiseResponse(c, req, "slow")
	}
	routes["test-fast"] = func(c *websocket.Conn, req PayloadRequest) {
		transmitPromiseResponse(c, req, "fast")
	}
	t.Cleanup(func() {
		delete(routes, "test-slow")
		delete(routes, "test-fast")
	})

	conn := dialWS(t)
	for _, route := range []string{"test-slow", "test-fast"} {
		if err := conn.WriteJSON(PayloadRequest{Route: route, ReplyChannel: route + "#1"}); err != nil {
			t.Fatal(err)
		}
	}
	if res := readReply(t, conn); res.Data != "fast" {
		t.Fatalf("first reply = %v, want the fast one", res.Data)
	}
	close(release)
	if res := readReply(t, conn); res.Data != "slow" {
		t.Fatalf("second reply = %v, want the slow one", res.Data)
	}
}

func TestPanickingHandlerRejects(t *testing.T) {
	routes["test-panic"] = func(c *websocket.Conn, req PayloadRequest) {
		panic("boom")
	}
	t.Cleanup(func() { delete(routes, "test-panic") })

	conn := dialWS(t)
	if err := conn.WriteJSON(PayloadRequest{Route: "test-panic", ReplyChannel: "test-panic#1"}); err != nil {
		t.Fatal(err)
	}
	if res := readReply(t, conn); res.Status != StatusFailure {
		t.Fatalf("status = %s, want %s", res.Status, StatusFailure)
	}
}

func TestTransmitWithPeerCountsSendsStoredCountsFirst(t *testing.T) {
	// one torrent whose stored count (1 seeder) has never been refreshed
	mem, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	mem.SetMaxOpenConns(1) // every connection would get its own :memory: database
	if _, err := mem.Exec(`CREATE TABLE torrentFile (id INTEGER PRIMARY KEY, infoHash TEXT,
		seeders INTEGER, leechers INTEGER, peersUpdatedAt INTEGER);
		INSERT INTO torrentFile VALUES (1, 'ab', 1, 0, NULL)`); err != nil {
		t.Fatal(err)
	}
	prevDB, prevScrape := db.DB, scrape
	db.DB = mem
	scrape = func(hashes []string) map[string]engine.PeerCounts {
		return map[string]engine.PeerCounts{"AB": {Seeders: 2}}
	}
	t.Cleanup(func() {
		db.DB, scrape = prevDB, prevScrape
		mem.Close()
	})

	routes["test-peers"] = func(c *websocket.Conn, req PayloadRequest) {
		torrents := []*models.TorrentFile{{ID: null.Int64From(1)}}
		transmitWithPeerCounts(c, req, torrents, func(withPeers []TorrentWithPeers) interface{} {
			return withPeers
		})
	}
	t.Cleanup(func() { delete(routes, "test-peers") })

	conn := dialWS(t)
	if err := conn.WriteJSON(PayloadRequest{Route: "test-peers", ReplyChannel: "test-peers#1"}); err != nil {
		t.Fatal(err)
	}
	for _, want := range []struct {
		status  StatusResponse
		seeders float64
	}{{StatusChunk, 1}, {StatusSuccess, 2}} {
		res := readReply(t, conn)
		got := res.Data.([]interface{})[0].(map[string]interface{})["seeders"]
		if res.Status != want.status || got != want.seeders {
			t.Fatalf("got %s with %v seeders, want %s with %v", res.Status, got, want.status, want.seeders)
		}
	}
}
