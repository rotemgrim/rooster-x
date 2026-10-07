package engine

import (
	"bytes"
	"os"
	"testing"
	"time"

	"go-poc/engine/internal/testtorrent"
	"go-poc/engine/lt"
)

// startSeeder runs a second libtorrent session that seeds tt from dir,
// listening on loopback only (no firewall prompt), and returns its port.
func startSeeder(t *testing.T, tt testtorrent.Torrent, dir string) int {
	t.Helper()
	s, err := lt.New(lt.Settings{ActiveDownloads: -1, ConnectionsLimit: 50, Offline: true, OfflineListen: "127.0.0.1:0"}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	hash, err := s.Add(lt.AddParams{TorrentFile: tt.TorrentPath, SavePath: dir, MaxConnections: -1})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the seeder to check its data", func() bool {
		st, err := s.Status(hash, false)
		return err == nil && st.Finished
	})
	port := s.ListenPort()
	if port == 0 {
		t.Fatal("seeder is not listening")
	}
	return port
}

// A real download of a magnet: the metadata comes from a peer, and the
// video must never exist under its real name before it is complete, or the
// walker would add an unfinished file to the library.
func TestMagnetDownloadKeepsUnfinishedFilesHidden(t *testing.T) {
	seedDir := t.TempDir()
	tt := testtorrent.Write(t, seedDir, "movie.mkv", 2<<20)
	port := startSeeder(t, tt, seedDir)

	startLoopback(t)
	setSettings(t, Settings{MaxDownloadKiB: 512, SequentialByDefault: true}) // ~4s, so there is time to look
	hash, err := Add(tt.Magnet)
	if err != nil {
		t.Fatal(err)
	}

	real := inData("movie.mkv")
	sawPart := false
	lastConnect := time.Time{}
	for deadline := time.Now().Add(30 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			st, _ := ses.Status(hash, false)
			t.Fatalf("timed out downloading: state=%d metadata=%v peers=%d uploadMode=%v paused=%v done=%d/%d",
				st.State, st.HasMetadata, st.NumPeers, st.UploadMode, st.Paused, st.TotalWantedDone, st.TotalWanted)
		}
		if time.Since(lastConnect) > time.Second {
			_ = ses.ConnectPeer(hash, "127.0.0.1", port)
			lastConnect = time.Now()
		}
		handleEvents()
		st, err := ses.Status(hash, false)
		if err != nil {
			t.Fatal(err)
		}
		sawPart = sawPart || fileExists(real+partSuffix)
		if fileExists(real) && !st.Finished {
			t.Fatalf("unfinished file exists under its real name (state %d, %d/%d bytes)", st.State, st.TotalWantedDone, st.TotalWanted)
		}
		if st.Finished && fileExists(real) {
			break
		}
	}
	if !sawPart {
		t.Error("never saw the .part file while downloading")
	}
	got, err := os.ReadFile(real)
	if err != nil || !bytes.Equal(got, tt.Data) {
		t.Errorf("downloaded file differs from the seeded one (err %v)", err)
	}
	if s, _ := Get(hash); s.Name != "movie.mkv" || !s.Done || s.Files[0].Path != "movie.mkv" {
		t.Errorf("status after download = %+v", s)
	}
}
