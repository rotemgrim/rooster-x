package lt

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"go-poc/engine/internal/testtorrent"
)

func offlineSession(t *testing.T) *Session {
	t.Helper()
	s, err := New(Settings{ActiveDownloads: -1, ConnectionsLimit: 200, Offline: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
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

func TestFinishedTorrentStatusReadAndResume(t *testing.T) {
	dir := t.TempDir()
	tt := testtorrent.Write(t, dir, "movie.mkv", 5*testtorrent.PieceLength/2)
	s := offlineSession(t)

	hash, err := s.Add(AddParams{TorrentFile: tt.TorrentPath, SavePath: dir, MaxConnections: -1})
	if err != nil {
		t.Fatal(err)
	}
	if hash != tt.Hash {
		t.Fatalf("hash = %s, want %s", hash, tt.Hash)
	}
	var st Status
	waitFor(t, "the existing file to be checked as finished", func() bool {
		st, err = s.Status(hash, true)
		return err == nil && st.Finished
	})
	if st.PieceCount != 3 || st.Pieces != "111" || st.TotalWanted != int64(len(tt.Data)) {
		t.Errorf("status: pieces=%d bitfield=%q wanted=%d", st.PieceCount, st.Pieces, st.TotalWanted)
	}
	if len(st.Files) != 1 || st.Files[0].Path != "movie.mkv" || st.Files[0].Done != int64(len(tt.Data)) {
		t.Errorf("files = %+v", st.Files)
	}

	buf := make([]byte, st.PieceLength)
	n, err := s.ReadPiece(context.Background(), hash, 2, buf)
	if err != nil {
		t.Fatal(err)
	}
	if want := tt.Data[2*testtorrent.PieceLength:]; !bytes.Equal(buf[:n], want) {
		t.Errorf("piece 2: got %d bytes, want %d matching bytes", n, len(want))
	}

	resumeDir := t.TempDir()
	if err := s.SaveResume(resumeDir, false, 5000); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(resumeDir, hash+".fastresume")); err != nil {
		t.Fatalf("no resume file: %v", err)
	}

	// a new session restores it from resume data, without the .torrent
	s.Close()
	s2 := offlineSession(t)
	if _, err := s2.Add(AddParams{ResumeFile: filepath.Join(resumeDir, hash+".fastresume"), SavePath: dir}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the resumed torrent to be finished", func() bool {
		st, err = s2.Status(hash, false)
		return err == nil && st.Finished && st.HasMetadata
	})
}

func TestReadPieceWaitsForContext(t *testing.T) {
	s := offlineSession(t)
	dir := t.TempDir()
	tt := testtorrent.Write(t, dir, "x.bin", testtorrent.PieceLength)
	// saved elsewhere, so the piece is missing and never arrives offline
	hash, err := s.Add(AddParams{TorrentFile: tt.TorrentPath, SavePath: t.TempDir(), MaxConnections: -1})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer cancel()
	if _, err := s.ReadPiece(ctx, hash, 0, make([]byte, testtorrent.PieceLength)); err != context.DeadlineExceeded {
		t.Errorf("err = %v, want deadline exceeded", err)
	}
}

func TestEventsAndRenames(t *testing.T) {
	dir := t.TempDir()
	tt := testtorrent.Write(t, dir, "movie.mkv", testtorrent.PieceLength)
	s := offlineSession(t)
	hash, err := s.Add(AddParams{TorrentFile: tt.TorrentPath, SavePath: dir, MaxConnections: -1})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RenameFile(hash, 0, "movie.mkv.part"); err != nil {
		t.Fatal(err)
	}
	var renamed bool
	waitFor(t, "the rename event", func() bool {
		events, _ := s.Events()
		for _, e := range events {
			renamed = renamed || (e.Type == "file_renamed" && e.Hash == hash && e.Name == "movie.mkv.part")
		}
		return renamed
	})
	if _, err := os.Stat(filepath.Join(dir, "movie.mkv.part")); err != nil {
		t.Errorf("file not renamed on disk: %v", err)
	}
	if err := s.Remove("0000000000000000000000000000000000000000"); err == nil {
		t.Error("removing an unknown torrent succeeded")
	}
}

func TestClosedSession(t *testing.T) {
	s := offlineSession(t)
	s.Close()
	if _, err := s.Statuses(); err != ErrClosed {
		t.Errorf("err = %v, want ErrClosed", err)
	}
}
