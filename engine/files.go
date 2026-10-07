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

// onMetadata runs once a torrent's file list is known: it applies the
// download order and part file names, and finishes preparing the torrent.
func onMetadata(hash string) {
	mu.Lock()
	e, ok := sessions[hash]
	var sequential, preparing bool
	if ok {
		sequential, preparing = e.Sequential, e.preparing
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
	renames, recheck := fixPartNames(hash, preparing)
	if !preparing {
		return
	}
	mu.Lock()
	e.pendingRenames, e.recheck = renames, recheck
	mu.Unlock()
	if renames == 0 {
		finishPreparing(hash)
	}
}

// onRenamed counts down a preparing torrent's renames and finishes preparing
// it after the last.
func onRenamed(hash string) {
	mu.Lock()
	e, ok := sessions[hash]
	done := false
	if ok && e.preparing && e.pendingRenames > 0 {
		e.pendingRenames--
		done = e.pendingRenames == 0
	}
	mu.Unlock()
	if done {
		finishPreparing(hash)
	}
}

// finishPreparing lets the torrent download, after rechecking the data on
// disk when a rename pointed it at data libtorrent hasn't checked yet.
func finishPreparing(hash string) {
	mu.Lock()
	e, ok := sessions[hash]
	recheck := ok && e.recheck
	if ok {
		e.preparing, e.recheck = false, false
	}
	mu.Unlock()
	if recheck {
		if err := ses.ForceRecheck(hash); err != nil {
			log.Println("Could not recheck torrent:", err)
		}
	}
	if err := ses.SetUploadMode(hash, false); err != nil {
		log.Println("Could not start torrent:", err)
	}
}

// fixPartNames renames the torrent's files to "<name>.part" while they are
// unfinished and back once complete. It returns how many renames it asked
// for, and whether one points at data already on disk (a .part file from the
// anacrolix engine), which libtorrent then has to recheck. While libtorrent checks the data on disk every file looks unfinished,
// so nothing is renamed then; the "checked" event runs it again. While
// preparing, progress isn't known yet, so the names follow what is on disk
// instead: only a file already under its real name keeps it.
func fixPartNames(hash string, preparing bool) (renames int, recheck bool) {
	st, err := ses.Status(hash, false)
	checking := st.State == lt.CheckingFiles || st.State == lt.CheckingResumeData
	if err != nil || !st.HasMetadata || (checking && !preparing) {
		return 0, false
	}
	for _, f := range st.Files {
		want := partName(f, preparing, st.SavePath)
		if f.Path == want {
			continue
		}
		if err := ses.RenameFile(hash, f.Index, want); err != nil {
			log.Println("Could not rename", f.Path, err)
			continue
		}
		renames++
		if _, err := os.Stat(filepath.Join(st.SavePath, filepath.FromSlash(want))); err == nil {
			recheck = true
		}
	}
	return renames, recheck
}

func partName(f lt.File, preparing bool, savePath string) string {
	name := strings.TrimSuffix(f.Path, partSuffix)
	unfinished := f.Done < f.Size
	if preparing {
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
		if !e.preparing {
			hashes = append(hashes, hash)
		}
	}
	mu.Unlock()
	for _, hash := range hashes {
		fixPartNames(hash, false)
	}
}

func isPreparing(hash string) bool {
	mu.Lock()
	defer mu.Unlock()
	e, ok := sessions[hash]
	return ok && e.preparing
}
