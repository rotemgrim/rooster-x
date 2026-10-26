package engine

import (
	"bytes"
	"context"
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

// Skipping the middle episode of a season pack: the others download and the
// torrent finishes without it, it can still be streamed, and wanting it
// again downloads the rest.
func TestSkippedFilesAreNotDownloaded(t *testing.T) {
	const p = testtorrent.PieceLength
	seedDir := t.TempDir()
	// e2 has pieces 3 and 4 to itself and shares 2 and 5 with e1 and e3
	tt := testtorrent.WriteFiles(t, seedDir, "season", []testtorrent.File{
		{Name: "e1.mkv", Size: 5 * p / 2}, {Name: "e2.mkv", Size: 3 * p}, {Name: "e3.mkv", Size: 3 * p / 2},
	})
	port := startSeeder(t, tt, seedDir)

	startLoopback(t)
	hash := addTorrentFile(t, tt, addOptions{})
	if err := SetFilesWanted(hash, []int{1}, false); err != nil {
		t.Fatal(err)
	}
	var lastConnect time.Time
	connect := func() {
		if time.Since(lastConnect) > time.Second {
			_ = ses.ConnectPeer(hash, "127.0.0.1", port)
			lastConnect = time.Now()
		}
	}
	e1, e2, e3 := inData("season/e1.mkv"), inData("season/e2.mkv"), inData("season/e3.mkv")
	var s Status
	drainEvents(t, "the wanted files to download", func() bool {
		connect()
		s, _ = Get(hash)
		return s.Done && fileExists(e1) && fileExists(e3)
	})
	if fileExists(e2) {
		t.Error("the skipped file exists under its real name")
	}
	if !s.Files[1].Skipped || s.Files[0].Skipped || s.Length >= int64(len(tt.Data)) || s.Files[1].Completed >= 3*p {
		t.Errorf("status with e2 skipped: length %d, files %+v", s.Length, s.Files)
	}
	for path, want := range map[string][]byte{e1: tt.Data[:5*p/2], e3: tt.Data[11*p/2:]} {
		if got, err := os.ReadFile(path); err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s differs from the seeded one (err %v)", path, err)
		}
	}
	if !fileExists(inData("." + hash + ".parts")) {
		t.Error("no part file for the pieces e2 shares")
	}

	// streaming the skipped episode fetches what is played
	connect()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	buf := make([]byte, p)
	if n, err := ses.ReadPiece(ctx, hash, 3, buf); err != nil || !bytes.Equal(buf[:n], tt.Data[3*p:4*p]) {
		t.Errorf("reading a piece of the skipped file: %d bytes, err %v", n, err)
	}

	if err := SetFilesWanted(hash, []int{1}, true); err != nil {
		t.Fatal(err)
	}
	drainEvents(t, "the file wanted again to download", func() bool {
		connect()
		s, _ = Get(hash)
		return s.Done && fileExists(e2)
	})
	if got, err := os.ReadFile(e2); err != nil || !bytes.Equal(got, tt.Data[5*p/2:][:3*p]) {
		t.Errorf("e2 differs from the seeded one (err %v)", err)
	}

	if err := Remove(hash, false); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the part file to be deleted", func() bool { return !fileExists(inData("." + hash + ".parts")) })
}
