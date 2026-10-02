package engine

import (
	"slices"
	"sort"

	"github.com/anacrolix/torrent"
)

type FileStatus struct {
	Index     int    `json:"index"`
	Path      string `json:"path"`
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
	mu.Lock()
	snaps := make([]sessionEntry, 0, len(sessions))
	for _, e := range sessions {
		snaps = append(snaps, *e)
	}
	mu.Unlock()
	out := make([]Status, 0, len(snaps))
	for i := range snaps {
		out = append(out, statusOf(&snaps[i]))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Get returns the status of one torrent, including the chunk map of its
// largest file.
func Get(hash string) (Status, error) {
	mu.Lock()
	e, err := entryLocked(hash)
	var snap sessionEntry
	if err == nil {
		snap = *e
	}
	mu.Unlock()
	if err != nil {
		return Status{}, err
	}
	s := statusOf(&snap)
	if i := largestFile(s.Files); i >= 0 {
		s.Files[i].Chunks = chunkMap(snap.live.t.Files()[i])
	}
	return s, nil
}

// statusOf builds the status from a snapshot of the entry, so it needs no
// lock.
func statusOf(e *sessionEntry) Status {
	t := e.live.t
	stats := t.Stats()
	s := Status{
		InfoHash:       e.live.hash,
		Name:           t.Name(),
		Peers:          stats.ActivePeers,
		Seeders:        stats.ConnectedSeeders,
		KnownPeers:     stats.TotalPeers,
		PiecesComplete: stats.PiecesComplete,
		Sequential:     e.Sequential,
		Paused:         e.Paused,
		DownSpeed:      int64(e.live.downSpeed),
		UpSpeed:        int64(e.live.upSpeed),
		ETA:            -1,
		Downloaded:     e.Downloaded,
		Uploaded:       e.Uploaded,
		AddedAt:        e.AddedAt,
		CompletedAt:    e.CompletedAt,
		SavePath:       dataDir,
	}
	if t.Info() != nil {
		s.HasInfo = true
		s.Length = t.Length()
		s.Completed = t.BytesCompleted()
		s.Done = isComplete(t)
		s.Ratio = shareRatio(e.Uploaded, e.Downloaded, s.Completed)
		if !s.Done && s.DownSpeed > 0 {
			s.ETA = (s.Length - s.Completed) / s.DownSpeed
		}
		s.NumPieces = t.NumPieces()
		s.PieceLength = t.Info().PieceLength
		s.Availability = availability(t)
		for i, f := range t.Files() {
			s.Files = append(s.Files, FileStatus{
				Index:     i,
				Path:      f.DisplayPath(),
				Length:    f.Length(),
				Completed: f.BytesCompleted(),
			})
		}
	}
	s.State = stateOf(s, e.live.queued)
	return s
}

// stateOf summarises a status; queued is the one input Status doesn't carry.
func stateOf(s Status, queued bool) State {
	switch {
	case s.Paused && s.Done:
		return StateCompleted
	case s.Paused:
		return StatePaused
	case !s.HasInfo:
		return StateMetadata
	case s.Done:
		return StateSeeding
	case queued:
		return StateQueued
	case s.DownSpeed > 0:
		return StateDownloading
	default:
		return StateStalled
	}
}

// largestFile returns the index of the biggest file, or -1 when there are
// none.
func largestFile(files []FileStatus) int {
	largest := -1
	for i, f := range files {
		if largest < 0 || f.Length > files[largest].Length {
			largest = i
		}
	}
	return largest
}

// availability returns how many full copies of the torrent the connected
// peers hold together: the count of the rarest piece plus the fraction of
// pieces that are more common than that.
func availability(t *torrent.Torrent) float64 {
	n := t.NumPieces()
	if n == 0 {
		return 0
	}
	counts := make([]int, n)
	for _, pc := range t.PeerConns() {
		for _, i := range pc.PeerPieces().ToArray() {
			if int(i) < n {
				counts[i]++
			}
		}
	}
	rarest := slices.Min(counts)
	above := 0
	for _, c := range counts {
		if c > rarest {
			above++
		}
	}
	return float64(rarest) + float64(above)/float64(n)
}

// chunkMap spreads the file's pieces over chunkBuckets slices by byte offset
// and encodes how much of each slice is verified as a digit 0-9.
func chunkMap(f *torrent.File) string {
	length := f.Length()
	if length == 0 {
		return ""
	}
	// bucket i covers bytes [bound(i), bound(i+1)); rounding up guarantees
	// bound(bucket+1) > pos, so the loop below always advances
	bound := func(i int64) int64 { return (i*length + chunkBuckets - 1) / chunkBuckets }
	var done [chunkBuckets]int64
	var pos int64
	for _, p := range f.State() {
		for b := p.Bytes; b > 0; {
			bucket := pos * chunkBuckets / length
			take := min(b, bound(bucket+1)-pos)
			if p.Complete {
				done[bucket] += take
			}
			pos += take
			b -= take
		}
	}
	out := make([]byte, chunkBuckets)
	for i := range out {
		size := bound(int64(i)+1) - bound(int64(i))
		out[i] = '0' + byte(done[i]*9/max(size, 1))
	}
	return string(out)
}
