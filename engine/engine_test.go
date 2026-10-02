package engine

// Helpers shared by the engine tests. They swap the package's globals (ses,
// dataDir, sessions, settings), so tests using them can't run in parallel.

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"go-poc/engine/internal/testtorrent"
	"go-poc/engine/lt"
)

// startOffline points the engine at a libtorrent session that opens no
// sockets (so Windows doesn't ask about the firewall) and finds no peers.
func startOffline(t *testing.T) {
	t.Helper()
	s, err := lt.New(lt.Settings{ActiveDownloads: -1, ConnectionsLimit: totalConnections, Offline: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	ses, dataDir = s, t.TempDir()
	if err := os.MkdirAll(resumePath(""), 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Close()
		ses = nil
		sessions = map[string]*sessionEntry{}
		settings = defaultSettings
		dirty = false
	})
}

// setSettings changes the settings without writing the settings file.
func setSettings(t *testing.T, s Settings) {
	t.Helper()
	mu.Lock()
	settings = s
	mu.Unlock()
	if err := ses.ApplySettings(ltSettings(s)); err != nil {
		t.Fatal(err)
	}
}

// addTorrentFile adds a test torrent through the engine, like Add does for
// a magnet but with the metadata already known.
func addTorrentFile(t *testing.T, tt testtorrent.Torrent, o addOptions) string {
	t.Helper()
	o.torrentFile = tt.TorrentPath
	hash, err := add(sessionEntry{Magnet: tt.Magnet}, o)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

// addFinished writes a file into the download folder and adds it as a
// torrent, then waits until libtorrent has verified every piece.
func addFinished(t *testing.T, name string) (string, testtorrent.Torrent) {
	t.Helper()
	tt := testtorrent.Write(t, dataDir, name, 3*testtorrent.PieceLength)
	hash := addTorrentFile(t, tt, addOptions{})
	waitFor(t, "the torrent to be finished", func() bool {
		st, err := ses.Status(hash, false)
		return err == nil && st.Finished
	})
	return hash, tt
}

// addMissing adds a torrent whose data isn't on disk, so it stays
// unfinished (there are no peers offline).
func addMissing(t *testing.T, name string, o addOptions) string {
	t.Helper()
	tt := testtorrent.Write(t, t.TempDir(), name, testtorrent.PieceLength)
	return addTorrentFile(t, tt, o)
}

// waitFor polls cond until it holds or 10s pass.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); !cond(); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

// drainEvents handles libtorrent's events the way the loop does until cond
// holds.
func drainEvents(t *testing.T, what string, cond func() bool) {
	t.Helper()
	waitFor(t, what, func() bool {
		handleEvents()
		return cond()
	})
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func inData(name string) string {
	return filepath.Join(dataDir, name)
}
