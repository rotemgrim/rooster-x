package engine

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"go-poc/engine/lt"
)

// edgeBytes is how much of the start and end of the video sequential mode
// fetches first: players need the start, and mp4/mkv often keep their
// index (moov atom / cues) at the end.
const edgeBytes = 16 << 20

const (
	priorityNormal = 4
	priorityTop    = 7
)

// onMetadata runs once a torrent's file list is known: it applies the part
// file names and the download order, and finishes a migration.
func onMetadata(hash string) {
	mu.Lock()
	e, ok := sessions[hash]
	var sequential, migrating bool
	if ok {
		sequential, migrating = e.Sequential, e.migrating
	}
	mu.Unlock()
	if !ok {
		return
	}
	if sequential {
		if err := applySequential(hash, true); err != nil {
			log.Println("Could not set download order:", err)
		}
	}
	renames := fixPartNames(hash, migrating)
	if !migrating {
		return
	}
	mu.Lock()
	e.pendingRenames = renames
	mu.Unlock()
	if renames == 0 {
		finishMigration(hash)
	}
}

// onRenamed counts down a migration's renames and finishes it after the last.
func onRenamed(hash string) {
	mu.Lock()
	e, ok := sessions[hash]
	done := false
	if ok && e.migrating && e.pendingRenames > 0 {
		e.pendingRenames--
		done = e.pendingRenames == 0
	}
	mu.Unlock()
	if done {
		finishMigration(hash)
	}
}

// finishMigration rechecks a migrated torrent's data under its part names and
// lets it download again.
func finishMigration(hash string) {
	if err := ses.ForceRecheck(hash); err != nil {
		log.Println("Could not recheck migrated torrent:", err)
	}
	if err := ses.SetUploadMode(hash, false); err != nil {
		log.Println("Could not resume migrated torrent:", err)
	}
	mu.Lock()
	if e, ok := sessions[hash]; ok {
		e.migrating = false
	}
	mu.Unlock()
}

// fixPartNames renames the torrent's files to "<name>.part" while they are
// unfinished and back once complete, and returns how many renames it asked
// for. While libtorrent checks the data on disk every file looks unfinished,
// so nothing is renamed then; the "checked" event runs it again. While
// migrating, progress isn't known yet, so the names follow what is on disk
// instead: an existing "<name>.part" keeps that name.
func fixPartNames(hash string, migrating bool) int {
	st, err := ses.Status(hash, false)
	checking := st.State == lt.CheckingFiles || st.State == lt.CheckingResumeData
	if err != nil || !st.HasMetadata || (checking && !migrating) {
		return 0
	}
	renames := 0
	for _, f := range st.Files {
		want := partName(f, migrating, st.SavePath)
		if f.Path == want {
			continue
		}
		if err := ses.RenameFile(hash, f.Index, want); err != nil {
			log.Println("Could not rename", f.Path, err)
			continue
		}
		renames++
	}
	return renames
}

func partName(f lt.File, migrating bool, savePath string) string {
	name := strings.TrimSuffix(f.Path, partSuffix)
	unfinished := f.Done < f.Size
	if migrating {
		_, err := os.Stat(filepath.Join(savePath, filepath.FromSlash(name)))
		unfinished = err != nil
	}
	if unfinished {
		return name + partSuffix
	}
	return name
}

// applySequential sets libtorrent's in-order downloading and raises the start
// and end of the largest file above everything else.
func applySequential(hash string, on bool) error {
	if err := ses.SetSequential(hash, on); err != nil {
		return err
	}
	st, err := ses.Status(hash, false)
	if err != nil || !st.HasMetadata {
		return err
	}
	priority := priorityNormal
	if on {
		priority = priorityTop
	}
	return ses.SetPiecePriorities(hash, edgePieces(st.Files, st.PieceLength), priority)
}

// edgePieces returns the pieces holding the first and last edgeBytes of the
// largest file.
func edgePieces(files []lt.File, pieceLen int64) []int {
	if len(files) == 0 || pieceLen <= 0 {
		return nil
	}
	video := files[0]
	for _, f := range files[1:] {
		if f.Size > video.Size {
			video = f
		}
	}
	if video.Size == 0 {
		return nil
	}
	first := int(video.Offset / pieceLen)
	last := int((video.Offset + video.Size - 1) / pieceLen)
	edge := int(max(edgeBytes/pieceLen, 1))
	seen := map[int]bool{}
	var pieces []int
	for i := 0; i < edge; i++ {
		for _, p := range []int{first + i, last - i} {
			if p >= first && p <= last && !seen[p] {
				seen[p] = true
				pieces = append(pieces, p)
			}
		}
	}
	return pieces
}

// healPartNames re-applies the part names everywhere, e.g. after a rename
// failed because a player had the file open.
func healPartNames() {
	mu.Lock()
	var hashes []string
	for hash, e := range sessions {
		if !e.migrating {
			hashes = append(hashes, hash)
		}
	}
	mu.Unlock()
	for _, hash := range hashes {
		fixPartNames(hash, false)
	}
}

func isMigrating(hash string) bool {
	mu.Lock()
	defer mu.Unlock()
	e, ok := sessions[hash]
	return ok && e.migrating
}
