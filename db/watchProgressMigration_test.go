package db

import (
	"database/sql"
	"encoding/json"
	"testing"
)

func memDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(1) // every connection would get its own :memory: database
	t.Cleanup(func() { conn.Close() })
	return conn
}

func TestSharedWatchProgressIsCopiedToEveryUser(t *testing.T) {
	conn := memDB(t)
	if _, err := conn.Exec(`
		CREATE TABLE user (id INTEGER PRIMARY KEY);
		INSERT INTO user VALUES (1), (2);
		CREATE TABLE watchProgress (
			rooster_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT '', ref_id INTEGER NOT NULL DEFAULT 0,
			path TEXT, title TEXT, percent REAL NOT NULL DEFAULT 0, time_pos REAL NOT NULL DEFAULT 0,
			duration REAL NOT NULL DEFAULT 0, finished BOOLEAN NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
		CREATE INDEX idx_watchProgress_kind_ref ON watchProgress(kind, ref_id);
		INSERT INTO watchProgress (rooster_id, kind, ref_id, time_pos, updated_at) VALUES ('movie-7', 'movie', 7, 600, 1);`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // safe to run again
		if err := EnsureWatchProgressTable(conn); err != nil {
			t.Fatal(err)
		}
	}
	for _, user := range []int64{1, 2} {
		wp, err := GetWatchProgress(conn, user, "movie-7")
		if err != nil || wp == nil || wp.TimePos != 600 {
			t.Fatalf("user %d progress = %+v, %v; want the shared 600s", user, wp, err)
		}
	}
}

func TestWatchProgressIsPerUser(t *testing.T) {
	conn := memDB(t)
	if _, err := conn.Exec(`CREATE TABLE user (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := EnsureWatchProgressTable(conn); err != nil {
		t.Fatal(err)
	}
	for _, p := range []WatchProgress{
		{UserID: 1, RoosterID: "episode-3", TimePos: 100},
		{UserID: 2, RoosterID: "episode-3", TimePos: 900},
		{UserID: 1, RoosterID: "episode-3", TimePos: 200},
	} {
		if err := UpsertWatchProgress(conn, p); err != nil {
			t.Fatal(err)
		}
	}
	for user, want := range map[int64]float64{1: 200, 2: 900} {
		got, err := GetWatchProgressBulk(conn, user, "episode", []int64{3})
		if err != nil || got[3] == nil || got[3].TimePos != want {
			t.Errorf("user %d episode 3 = %+v, %v; want %vs", user, got[3], err, want)
		}
	}
	if wp, _ := GetWatchProgress(conn, 3, "episode-3"); wp != nil {
		t.Errorf("a user who never watched has progress %+v", wp)
	}
}

// The app reads these names (renderer/services/ipc.service.ts IWatchProgress).
func TestWatchProgressJSON(t *testing.T) {
	b, err := json.Marshal(WatchProgress{UserID: 1, RoosterID: "movie-7", Kind: "movie", RefID: 7, Path: "x", TimePos: 5})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]interface{}
	json.Unmarshal(b, &got)
	for _, key := range []string{"roosterId", "kind", "refId", "percent", "timePos", "duration", "finished", "updatedAt"} {
		if _, ok := got[key]; !ok {
			t.Errorf("missing %q in %s", key, b)
		}
	}
	if len(got) != 8 {
		t.Errorf("sends more than the app reads: %s", b)
	}
}
