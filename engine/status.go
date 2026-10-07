package engine

import (
	"sort"
	"strings"

	"go-poc/engine/lt"
)

type FileStatus struct {
	Index     int    `json:"index"`
	Path      string `json:"path"` // without the .part suffix
	Length    int64  `json:"length"`
	Completed int64  `json:"completed"`
	// Chunks maps the file onto chunkBuckets equal slices, one digit each:
	// 0 = nothing verified .. 9 = fully verified. Only set by Get, for the
	// largest file (the video), so the UI can show which parts are playable.
	Chunks string `json:"chunks,omitempty"`
}

const chunkBuckets = 100

type State string

const (
	StateChecking    State = "checking" // verifying data on disk
	StateMetadata    State = "metadata"
	StateDownloading State = "downloading"
	StateStalled     State = "stalled" // downloading, but nothing is arriving
	StateQueued      State = "queued"
	StateSeeding     State = "seeding"
	StatePaused      State = "paused"
	StateCompleted   State = "completed" // paused after finishing
)

type Status struct {
	InfoHash   string `json:"infoHash"`
	Name       string `json:"name"`
	HasInfo    bool   `json:"hasInfo"`
	Length     int64  `json:"length"`
	Completed  int64  `json:"completed"`
	Done       bool   `json:"done"`
	Peers      int    `json:"peers"`   // connected peers, seeders included
	Seeders    int    `json:"seeders"` // connected seeders
	KnownPeers int    `json:"knownPeers"`
	Sequential bool   `json:"sequential"`
	Paused     bool   `json:"paused"`
	State      State  `json:"state"`
	DownSpeed  int64  `json:"downSpeed"` // bytes/s
	UpSpeed    int64  `json:"upSpeed"`
	// ETA is seconds until finished, -1 when unknown (finished, or nothing
	// arriving).
	ETA         int64   `json:"eta"`
	Downloaded  int64   `json:"downloaded"` // payload bytes, all runs
	Uploaded    int64   `json:"uploaded"`
	Ratio       float64 `json:"ratio"`
	AddedAt     int64   `json:"addedAt"`
	CompletedAt int64   `json:"completedAt"`
	// Availability is the number of full copies among connected peers
	// (qBittorrent's "distributed copies").
	Availability   float64      `json:"availability"`
	NumPieces      int          `json:"numPieces"`
	PieceLength    int64        `json:"pieceLength"`
	PiecesComplete int          `json:"piecesComplete"`
	SavePath       string       `json:"savePath"`
	Files          []FileStatus `json:"files"`
}

// List returns the status of every torrent in the engine.
func List() []Status {
	if ses == nil {
		return []Status{}
	}
	statuses, err := ses.Statuses()
	if err != nil {
		return []Status{}
	}
	out := make([]Status, 0, len(statuses))
	mu.Lock()
	for _, st := range statuses {
		if e, ok := sessions[st.Hash]; ok {
			out = append(out, statusOf(st, *e))
		}
	}
	mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Get returns the status of one torrent, including the chunk map of its
// largest file.
func Get(hash string) (Status, error) {
	if ses == nil {
		return Status{}, errNotRunning
	}
	st, err := ses.Status(hash, true)
	if err != nil {
		return Status{}, err
	}
	mu.Lock()
	e, err := entryLocked(st.Hash)
	var entry sessionEntry
	if err == nil {
		entry = *e
	}
	mu.Unlock()
	if err != nil {
		return Status{}, err
	}
	s := statusOf(st, entry)
	if i := largestFile(s.Files); i >= 0 {
		f := st.Files[i]
		s.Files[i].Chunks = chunkMap(st.Pieces, st.PieceLength, f.Offset, f.Size)
	}
	return s, nil
}

func statusOf(st lt.Status, e sessionEntry) Status {
	s := Status{
		InfoHash:       st.Hash,
		Name:           st.Name,
		HasInfo:        st.HasMetadata,
		Length:         st.TotalWanted,
		Completed:      st.TotalWantedDone,
		Done:           st.HasMetadata && st.Finished,
		Peers:          st.NumPeers,
		Seeders:        st.NumSeeds,
		KnownPeers:     st.ListPeers,
		Sequential:     e.Sequential,
		Paused:         userPaused(st.Paused, st.AutoManaged),
		State:          stateOf(st),
		DownSpeed:      st.DownRate,
		UpSpeed:        st.UpRate,
		ETA:            -1,
		Downloaded:     st.AllTimeDownload,
		Uploaded:       st.AllTimeUpload,
		Ratio:          shareRatio(st.AllTimeUpload, st.AllTimeDownload, st.TotalDone),
		AddedAt:        st.AddedTime,
		CompletedAt:    st.CompletedTime,
		Availability:   max(st.DistributedCopies, 0),
		NumPieces:      st.PieceCount,
		PieceLength:    st.PieceLength,
		PiecesComplete: st.NumPieces,
		SavePath:       st.SavePath,
	}
	if !s.Done && s.DownSpeed > 0 {
		s.ETA = (s.Length - s.Completed) / s.DownSpeed
	}
	for _, f := range st.Files {
		s.Files = append(s.Files, FileStatus{
			Index:     f.Index,
			Path:      strings.TrimSuffix(f.Path, partSuffix),
			Length:    f.Size,
			Completed: f.Done,
		})
	}
	return s
}

func stateOf(st lt.Status) State {
	switch {
	case userPaused(st.Paused, st.AutoManaged) && st.Finished:
		return StateCompleted
	case userPaused(st.Paused, st.AutoManaged):
		return StatePaused
	case st.State == lt.CheckingFiles || st.State == lt.CheckingResumeData:
		return StateChecking
	case !st.HasMetadata:
		return StateMetadata
	case st.Finished:
		return StateSeeding
	case st.Paused: // auto-managed: waiting for a download slot
		return StateQueued
	case st.DownRate > 0:
		return StateDownloading
	default:
		return StateStalled
	}
}

// largestFile returns the index in files of the biggest file, or -1 when
// there are none.
func largestFile(files []FileStatus) int {
	largest := -1
	for i, f := range files {
		if largest < 0 || f.Length > files[largest].Length {
			largest = i
		}
	}
	return largest
}

// chunkMap spreads a file over chunkBuckets slices by byte offset and
// encodes how much of each slice is verified as a digit 0-9. pieces has a
// '1' for every verified piece of the torrent; the file starts at offset.
func chunkMap(pieces string, pieceLen, offset, length int64) string {
	if length == 0 || pieceLen <= 0 {
		return ""
	}
	// bucket i covers bytes [bound(i), bound(i+1)); rounding up guarantees
	// bound(bucket+1) > pos, so the loop below always advances
	bound := func(i int64) int64 { return (i*length + chunkBuckets - 1) / chunkBuckets }
	var done [chunkBuckets]int64
	for pos := int64(0); pos < length; {
		piece := (offset + pos) / pieceLen
		end := min((piece+1)*pieceLen-offset, length)
		have := piece < int64(len(pieces)) && pieces[piece] == '1'
		for pos < end {
			bucket := pos * chunkBuckets / length
			take := min(end, bound(bucket+1)) - pos
			if have {
				done[bucket] += take
			}
			pos += take
		}
	}
	out := make([]byte, chunkBuckets)
	for i := range out {
		size := bound(int64(i)+1) - bound(int64(i))
		out[i] = '0' + byte(done[i]*9/max(size, 1))
	}
	return string(out)
}
