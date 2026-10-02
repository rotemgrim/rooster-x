package engine

import (
	"strings"
	"testing"

	"go-poc/engine/lt"
)

func TestChunkMap(t *testing.T) {
	tests := []struct {
		name                     string
		pieces                   string
		pieceLen, offset, length int64
		want                     string
	}{
		{"all verified", "1111", 25, 0, 100, strings.Repeat("9", 100)},
		{"first half", "1100", 25, 0, 100, strings.Repeat("9", 50) + strings.Repeat("0", 50)},
		// the file starts halfway into piece 1 and ends halfway into piece 2
		{"offset into the torrent", "0100", 100, 150, 100, strings.Repeat("9", 50) + strings.Repeat("0", 50)},
		{"offset, both pieces", "0110", 100, 150, 100, strings.Repeat("9", 100)},
		{"empty file", "1", 10, 0, 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := chunkMap(tt.pieces, tt.pieceLen, tt.offset, tt.length); got != tt.want {
				t.Errorf("chunkMap = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestStateOf(t *testing.T) {
	tests := []struct {
		name string
		st   lt.Status
		want State
	}{
		{"paused by the user", lt.Status{HasMetadata: true, Paused: true}, StatePaused},
		{"paused after finishing", lt.Status{HasMetadata: true, Paused: true, Finished: true}, StateCompleted},
		{"waiting in the queue", lt.Status{HasMetadata: true, Paused: true, AutoManaged: true, State: lt.Downloading}, StateQueued},
		{"checking", lt.Status{HasMetadata: true, AutoManaged: true, State: lt.CheckingFiles}, StateChecking},
		{"no metadata yet", lt.Status{AutoManaged: true, State: lt.DownloadingMetadata}, StateMetadata},
		{"seeding", lt.Status{HasMetadata: true, AutoManaged: true, Finished: true, State: lt.Seeding}, StateSeeding},
		{"downloading", lt.Status{HasMetadata: true, AutoManaged: true, State: lt.Downloading, DownRate: 1}, StateDownloading},
		{"stalled", lt.Status{HasMetadata: true, AutoManaged: true, State: lt.Downloading}, StateStalled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stateOf(tt.st); got != tt.want {
				t.Errorf("stateOf = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestGetReportsAFinishedTorrent(t *testing.T) {
	startOffline(t)
	hash, tt := addFinished(t, "movie.mkv")
	s, err := Get(hash)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Done || s.State != StateSeeding || s.ETA != -1 || s.Length != int64(len(tt.Data)) || s.PiecesComplete != 3 {
		t.Errorf("status = %+v", s)
	}
	if len(s.Files) != 1 || s.Files[0].Chunks != strings.Repeat("9", chunkBuckets) {
		t.Errorf("files = %+v", s.Files)
	}
	if list := List(); len(list) != 1 || list[0].InfoHash != hash || list[0].Files[0].Chunks != "" {
		t.Errorf("List = %+v", list)
	}
}
