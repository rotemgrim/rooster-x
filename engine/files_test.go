package engine

import (
	"os"
	"reflect"
	"testing"

	"go-poc/engine/internal/testtorrent"
	"go-poc/engine/lt"
)

func TestEdgePieces(t *testing.T) {
	const piece = 4 << 20 // edgeBytes is 4 pieces
	tests := []struct {
		name  string
		files []lt.File
		want  []int
	}{
		{"big file: 4 pieces each end", []lt.File{{Offset: 0, Size: 100 * piece}}, []int{0, 99, 1, 98, 2, 97, 3, 96}},
		{"small file: every piece once", []lt.File{{Offset: 0, Size: 3 * piece}}, []int{0, 2, 1}},
		{"largest file, not the first", []lt.File{{Offset: 0, Size: piece}, {Offset: piece, Size: 10 * piece}}, []int{1, 10, 2, 9, 3, 8, 4, 7}},
		{"no files", nil, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := edgePieces(tt.files, piece); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("edgePieces = %v, want %v", got, tt.want)
			}
		})
	}
}

func filePath(t *testing.T, hash string) string {
	t.Helper()
	st, err := ses.Status(hash, false)
	if err != nil || len(st.Files) != 1 {
		t.Fatalf("status: %v, files %+v", err, st.Files)
	}
	return st.Files[0].Path
}

func TestUnfinishedFilesGetPartNames(t *testing.T) {
	startOffline(t)
	missing := addMissing(t, "missing.mkv", addOptions{})
	drainEvents(t, "the .part rename", func() bool { return filePath(t, missing) == "missing.mkv.part" })

	finished, _ := addFinished(t, "done.mkv")
	healPartNames()
	handleEvents()
	if got := filePath(t, finished); got != "done.mkv" {
		t.Errorf("finished file renamed to %s", got)
	}
}

func TestHealRenamesFinishedPartFilesBack(t *testing.T) {
	startOffline(t)
	hash, _ := addFinished(t, "movie.mkv")
	// e.g. the rename after the last piece failed while a player had it open
	if err := ses.RenameFile(hash, 0, "movie.mkv.part"); err != nil {
		t.Fatal(err)
	}
	drainEvents(t, "the manual rename", func() bool { return fileExists(inData("movie.mkv.part")) })

	healPartNames()
	drainEvents(t, "the heal rename", func() bool { return fileExists(inData("movie.mkv")) })
	if got := filePath(t, hash); got != "movie.mkv" {
		t.Errorf("name = %s, want movie.mkv", got)
	}
}

// A torrent carried over from the anacrolix engine (no resume data) has its
// unfinished data in <name>.part, which libtorrent knows nothing about.
func TestMigrationFindsPartFileData(t *testing.T) {
	startOffline(t)
	tt := testtorrent.Write(t, dataDir, "movie.mkv", 3*testtorrent.PieceLength)
	if err := os.Rename(tt.DataPath, tt.DataPath+".part"); err != nil {
		t.Fatal(err)
	}
	hash := addTorrentFile(t, tt, addOptions{restored: true})
	drainEvents(t, "the migration to finish", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return !sessions[hash].migrating
	})
	waitFor(t, "the recheck to find the data", func() bool {
		st, err := ses.Status(hash, false)
		return err == nil && st.Finished && !st.UploadMode
	})
	healPartNames()
	drainEvents(t, "the rename to the real name", func() bool { return fileExists(tt.DataPath) })
}

func TestMigrationKeepsFinishedFiles(t *testing.T) {
	startOffline(t)
	tt := testtorrent.Write(t, dataDir, "movie.mkv", 2*testtorrent.PieceLength)
	hash := addTorrentFile(t, tt, addOptions{restored: true})
	waitFor(t, "the recheck", func() bool {
		st, err := ses.Status(hash, false)
		return err == nil && st.Finished && !st.UploadMode
	})
	if got := filePath(t, hash); got != "movie.mkv" {
		t.Errorf("name = %s, want movie.mkv", got)
	}
}

// The delete button: remove the torrent and its files, whichever name they
// have (finished or .part).
func TestRemoveDeletesFiles(t *testing.T) {
	startOffline(t)
	finished, tt := addFinished(t, "movie.mkv")

	partial := testtorrent.Write(t, dataDir, "partial.mkv", 2*testtorrent.PieceLength)
	// half the data: piece 1 is missing, so the file stays unfinished
	if err := os.WriteFile(partial.DataPath, partial.Data[:testtorrent.PieceLength], 0644); err != nil {
		t.Fatal(err)
	}
	unfinished := addTorrentFile(t, partial, addOptions{})
	drainEvents(t, "the .part rename", func() bool { return fileExists(partial.DataPath + partSuffix) })
	if err := ses.SaveResume(resumePath(""), false, 5000); err != nil || !fileExists(resumePath(finished)) {
		t.Fatalf("no resume data to clean up: %v", err)
	}

	for _, hash := range []string{finished, unfinished} {
		if err := Remove(hash, true); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, "the files to be deleted", func() bool {
		return !fileExists(tt.DataPath) && !fileExists(partial.DataPath+partSuffix) && !fileExists(partial.DataPath)
	})
	if list := List(); len(list) != 0 {
		t.Errorf("still listed: %+v", list)
	}
	if _, err := Get(finished); err == nil {
		t.Error("Get still finds the removed torrent")
	}
	if fileExists(resumePath(finished)) {
		t.Error("resume data left behind")
	}
}

func TestRemoveUnknownTorrent(t *testing.T) {
	startOffline(t)
	if err := Remove("0000000000000000000000000000000000000000", true); err == nil {
		t.Error("removing an unknown torrent succeeded")
	}
}
