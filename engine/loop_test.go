package engine

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"go-poc/engine/internal/testtorrent"
)

func TestSeedingLimitEndsSeeding(t *testing.T) {
	for _, action := range []SeedEndAction{SeedEndPause, SeedEndRemove} {
		t.Run(string(action), func(t *testing.T) {
			startOffline(t)
			setSettings(t, Settings{SeedDays: 2, SeedEndAction: action})
			hash, tt := addFinished(t, "movie.mkv")
			now := time.Now()

			if done := seedingFinished(now); len(done) != 0 {
				t.Fatalf("seeding ended right after finishing: %v", done)
			}
			if done := seedingFinished(now.Add(49 * time.Hour)); !reflect.DeepEqual(done, []string{hash}) {
				t.Fatalf("seedingFinished = %v, want [%s]", done, hash)
			}
			endSeeding(hash)

			s, err := Get(hash)
			switch action {
			case SeedEndPause:
				if err != nil || s.State != StateCompleted {
					t.Errorf("after pause: state=%s err=%v, want completed", s.State, err)
				}
				if done := seedingFinished(now.Add(49 * time.Hour)); len(done) != 0 {
					t.Errorf("a paused torrent hit its limit again: %v", done)
				}
			case SeedEndRemove:
				if err == nil {
					t.Errorf("after remove: still listed as %s", s.State)
				}
				if !fileExists(tt.DataPath) {
					t.Error("remove deleted the file")
				}
			}
		})
	}
}

func TestResumeRestartsSeedingClock(t *testing.T) {
	startOffline(t)
	setSettings(t, Settings{SeedDays: 2})
	hash, _ := addFinished(t, "movie.mkv")
	if err := SetPaused(hash, true); err != nil {
		t.Fatal(err)
	}
	if err := SetPaused(hash, false); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	resumedAt := sessions[hash].ResumedAt
	mu.Unlock()
	if time.Since(time.Unix(resumedAt, 0)) > time.Minute {
		t.Fatalf("resumedAt = %d, want now", resumedAt)
	}
	if done := seedingFinished(time.Now().Add(47 * time.Hour)); len(done) != 0 {
		t.Errorf("limit counted from completion, not the resume: %v", done)
	}
}

func TestQueueHoldsDownloadsBeyondTheLimit(t *testing.T) {
	startOffline(t)
	setSettings(t, Settings{MaxActiveDownloads: 2})
	hashes := []string{
		addMissing(t, "a.mkv", addOptions{}),
		addMissing(t, "b.mkv", addOptions{}),
		addMissing(t, "c.mkv", addOptions{}),
	}
	states := func() []State {
		var out []State
		for _, h := range hashes {
			s, err := Get(h)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, s.State)
		}
		return out
	}
	waitFor(t, "the newest torrent to be queued", func() bool {
		s := states()
		return s[0] != StateQueued && s[1] != StateQueued && s[2] == StateQueued
	})

	// pausing one frees its slot
	if err := SetPaused(hashes[0], true); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the queued torrent to start", func() bool {
		s := states()
		return s[0] == StatePaused && s[2] != StateQueued
	})
}

func TestAddPausedStaysPaused(t *testing.T) {
	startOffline(t)
	hash := addMissing(t, "a.mkv", addOptions{paused: true})
	time.Sleep(200 * time.Millisecond)
	if s, err := Get(hash); err != nil || s.State != StatePaused || !s.Paused {
		t.Errorf("state=%s paused=%v err=%v, want paused", s.State, s.Paused, err)
	}
}

// What Stop saves, Start restores: the session file plus resume data.
func TestRestoreFromResumeData(t *testing.T) {
	startOffline(t)
	hash, _ := addFinished(t, "movie.mkv")
	if err := SetSequential(hash, true); err != nil {
		t.Fatal(err)
	}
	if err := ses.SaveResume(resumePath(""), false, 5000); err != nil {
		t.Fatal(err)
	}
	flushSession()
	entries := loadSession()

	// a fresh session in the same download folder, like the next run
	dir := dataDir
	ses.Close()
	startOffline(t)
	dataDir = dir
	for _, e := range entries {
		if _, err := add(e, addOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	mu.Lock()
	e := sessions[hash]
	mu.Unlock()
	if e == nil || e.preparing || !e.Sequential {
		t.Fatalf("restored entry = %+v", e)
	}
	waitFor(t, "the restored torrent", func() bool {
		s, err := Get(hash)
		return err == nil && s.Done && s.AddedAt > 0 && s.CompletedAt > 0
	})
}

func TestSessionFileOnlyWrittenWhenChanged(t *testing.T) {
	startOffline(t)
	addMissing(t, "a.mkv", addOptions{})
	flushSession()
	path := inData(sessionFile)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	flushSession()
	if fileExists(path) {
		t.Error("an unchanged session was written again")
	}
}

// A torrent added from a .torrent file has no magnet, so until libtorrent
// saves resume data for it the next run adds it from the kept file.
func TestRestoreFromTorrentFile(t *testing.T) {
	startOffline(t)
	tt := testtorrent.Write(t, dataDir, "movie.mkv", 2*testtorrent.PieceLength)
	b, err := os.ReadFile(tt.TorrentPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AddTorrentFile([]byte("not a torrent")); err == nil {
		t.Error("adding junk succeeded")
	}
	hash, err := AddTorrentFile(b)
	if err != nil || hash != tt.Hash {
		t.Fatalf("hash = %s, err = %v, want %s", hash, err, tt.Hash)
	}
	flushSession()
	entries := loadSession()

	dir := dataDir
	ses.Close()
	startOffline(t)
	dataDir = dir
	for _, e := range entries {
		if _, err := add(e, addOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, "the restored torrent", func() bool {
		s, err := Get(hash)
		return err == nil && s.Done
	})
	if err := Remove(hash, false); err != nil {
		t.Fatal(err)
	}
	if fileExists(torrentPath(hash)) {
		t.Error("torrent file left behind")
	}
	if left, _ := filepath.Glob(filepath.Join(resumePath(""), "*")); len(left) != 0 {
		t.Errorf("left in the resume folder: %v", left)
	}
}
