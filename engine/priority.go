package engine

import (
	"time"

	"github.com/anacrolix/torrent"
)

const (
	prioritizeEvery = 2 * time.Second
	// edgeBytes is how much of the start and end of the video is fetched
	// first: players need the start, and mp4/mkv often keep their index
	// (moov atom / cues) at the end.
	edgeBytes = 16 << 20
	// windowBytes is how far ahead of the first missing piece the
	// sequential window reaches.
	windowBytes = 64 << 20
)

// prioritize keeps a sequential torrent downloading the edges of its largest
// file first and then front to back, by raising piece priorities above the
// Normal level that DownloadAll gives every file. A streaming reader's
// current pieces get Now, which still wins over these. When
// sequential is switched off the raised pieces go back to None, leaving the
// usual rarest-first order.
func prioritize(t *torrent.Torrent) {
	raised := map[int]torrent.PiecePriority{}
	tick := time.NewTicker(prioritizeEvery)
	defer tick.Stop()
	for {
		want := map[int]torrent.PiecePriority{}
		if isSequential(t) {
			want = sequentialPriorities(t)
		}
		for i := range raised {
			if _, ok := want[i]; !ok {
				t.Piece(i).SetPriority(torrent.PiecePriorityNone)
				delete(raised, i)
			}
		}
		for i, p := range want {
			if raised[i] != p {
				t.Piece(i).SetPriority(p)
				raised[i] = p
			}
		}
		if t.BytesMissing() == 0 {
			return
		}
		select {
		case <-t.Closed():
			return
		case <-tick.C:
		}
	}
}

// sequentialPriorities returns the incomplete pieces to raise: the first and
// last edgeBytes of the largest file at Readahead, and a window of
// windowBytes from the torrent's first incomplete piece at High.
func sequentialPriorities(t *torrent.Torrent) map[int]torrent.PiecePriority {
	want := map[int]torrent.PiecePriority{}
	info := t.Info()
	if info == nil || info.PieceLength == 0 {
		return want
	}
	pieceLen := info.PieceLength
	piecesFor := func(bytes int64) int { return int(max(2, bytes/pieceLen)) }
	set := func(i int, p torrent.PiecePriority) {
		if i < 0 || i >= t.NumPieces() || t.PieceState(i).Complete {
			return
		}
		if p > want[i] {
			want[i] = p
		}
	}

	// sliding window from the first piece we don't have yet
	first := -1
	for i := 0; i < t.NumPieces(); i++ {
		if !t.PieceState(i).Complete {
			first = i
			break
		}
	}
	if first < 0 {
		return want
	}
	for i := first; i < first+piecesFor(windowBytes); i++ {
		set(i, torrent.PiecePriorityHigh)
	}

	// start and end of the video, ahead of the window
	var video *torrent.File
	for _, f := range t.Files() {
		if video == nil || f.Length() > video.Length() {
			video = f
		}
	}
	begin, end := video.BeginPieceIndex(), video.EndPieceIndex()
	edge := min(piecesFor(edgeBytes), end-begin)
	for i := 0; i < edge; i++ {
		set(begin+i, torrent.PiecePriorityReadahead)
		set(end-1-i, torrent.PiecePriorityReadahead)
	}
	return want
}
