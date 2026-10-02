package engine

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSampleStampsCompletionAndEndsSeeding(t *testing.T) {
	for _, action := range []SeedEndAction{SeedEndPause, SeedEndRemove} {
		t.Run(string(action), func(t *testing.T) {
			startOfflineClient(t)
			settings.SeedDays = 2
			settings.SeedEndAction = action
			hash := addFinishedTorrent(t)
			now := time.Now()

			if seeded := sample(now, false); len(seeded) != 0 {
				t.Fatalf("seeding ended right after finishing: %v", seeded)
			}
			s, err := Get(hash)
			if err != nil {
				t.Fatal(err)
			}
			if s.CompletedAt != now.Unix() || s.State != StateSeeding || !s.Done || s.ETA != -1 {
				t.Fatalf("after finishing: completedAt=%d state=%s done=%v eta=%d", s.CompletedAt, s.State, s.Done, s.ETA)
			}

			seeded := sample(now.Add(49*time.Hour), false)
			if len(seeded) != 1 || seeded[0] != hash {
				t.Fatalf("seeded = %v, want [%s]", seeded, hash[:4])
			}
			endSeeding(hash)

			s, err = Get(hash)
			switch action {
			case SeedEndPause:
				if err != nil || s.State != StateCompleted {
					t.Errorf("after pause: state=%s err=%v, want completed", s.State, err)
				}
			case SeedEndRemove:
				if err == nil {
					t.Errorf("after remove: still listed as %s", s.State)
				}
				if _, statErr := os.Stat(filepath.Join(dataDir, "movie.mkv")); statErr != nil {
					t.Errorf("remove deleted the file: %v", statErr)
				}
			}
		})
	}
}

func TestSampleMarksTotalsForSaving(t *testing.T) {
	startOfflineClient(t)
	addOfflineTorrent(t, 1, 0)
	flushSession() // the add itself is saved

	sample(time.Now(), false)
	if dirty {
		t.Error("a plain sample marked the session file for saving")
	}
	sample(time.Now(), true)
	if !dirty {
		t.Error("a totals sample did not mark the session file for saving")
	}
}
