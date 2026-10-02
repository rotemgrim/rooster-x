package engine

// Helpers shared by the engine tests. They swap the package's globals
// (client, dataDir, sessions, settings), so tests using them can't run in
// parallel.

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

// startOfflineClient points the engine at a client with no networking, so
// magnets stay without metadata (unfinished) and nothing is downloaded. It
// opens no sockets at all, so Windows doesn't ask to allow engine.test.exe
// through the firewall.
func startOfflineClient(t *testing.T) {
	t.Helper()
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir = t.TempDir()
	cfg.NoDHT = true
	cfg.DisableTrackers = true
	cfg.NoDefaultPortForwarding = true
	cfg.DisableTCP = true
	cfg.DisableUTP = true
	cfg.DisableWebseeds = true
	c, err := torrent.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if addrs := c.ListenAddrs(); len(addrs) > 0 {
		c.Close()
		t.Fatalf("offline test client is listening on %v", addrs)
	}
	client, dataDir = c, cfg.DataDir
	t.Cleanup(func() {
		c.Close()
		client = nil
		sessions = map[string]*sessionEntry{}
		settings = defaultSettings
	})
}

// addOfflineTorrent adds a magnet that never gets metadata, so it stays
// unfinished. n picks a distinct info hash.
func addOfflineTorrent(t *testing.T, n int, addedAt int64) string {
	t.Helper()
	hash, err := add(sessionEntry{Magnet: fmt.Sprintf("magnet:?xt=urn:btih:%040x", n), AddedAt: addedAt})
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

// addFinishedTorrent writes a file into the download folder, adds it as a
// magnet like the app does, supplies its metadata locally and waits until
// anacrolix has verified every piece.
func addFinishedTorrent(t *testing.T) string {
	t.Helper()
	path := filepath.Join(dataDir, "movie.mkv")
	data := make([]byte, 64<<10)
	_, _ = rand.Read(data)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{PieceLength: 16 << 10}
	if err := info.BuildFromFilePath(path); err != nil {
		t.Fatal(err)
	}
	mi := metainfo.MetaInfo{InfoBytes: bencode.MustMarshal(info)}

	hash, err := add(sessionEntry{Magnet: mi.Magnet(nil, &info).String()})
	if err != nil {
		t.Fatal(err)
	}
	tor, err := client.AddTorrent(&mi) // the same torrent, now with its metadata
	if err != nil {
		t.Fatal(err)
	}
	if err := tor.VerifyDataContext(t.Context()); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(10 * time.Second); !isComplete(tor); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("torrent never completed")
		}
	}
	return hash
}
