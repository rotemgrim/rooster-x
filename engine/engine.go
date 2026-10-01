// Package engine embeds a BitTorrent client (anacrolix/torrent) so RoosterX
// can download and stream torrents itself instead of handing magnets to an
// external app.
//
// Files are written as "<name>.part" while downloading and renamed to their
// real name once every piece of the file has been verified (anacrolix's part
// files). The walker matches media by extension, so it ignores unfinished
// files and picks them up when the rename happens.
package engine

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"
)

// sessionFile lists the torrents that were added, so they are re-added (and
// resume from the stored piece state) after a restart. anacrolix does not
// persist its torrent list itself.
const sessionFile = ".roosterx-torrents.json"

type sessionEntry struct {
	Magnet string `json:"magnet"`
	// Sequential downloads the first and last parts of the video first and
	// then the rest in order, so playback can start early. On by default.
	Sequential bool `json:"sequential"`
}

var (
	client  *torrent.Client
	dataDir string

	mu       sync.Mutex
	sessions = map[string]*sessionEntry{} // infoHash -> entry
)

// Start creates the torrent client, downloading into dir.
func Start(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir = dir
	cfg.Seed = true
	c, err := torrent.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("could not start torrent client: %w", err)
	}
	client = c
	dataDir = dir
	log.Println("Torrent engine downloading to", dir)

	for _, e := range loadSession() {
		if _, err := add(e.Magnet, e.Sequential); err != nil {
			log.Println("Could not resume torrent:", err)
		}
	}
	return nil
}

// Stop closes all connections and flushes piece state.
func Stop() {
	if client != nil {
		client.Close()
	}
}

// Add starts downloading a magnet and returns its info hash. All files are
// downloaded once the metadata arrives from peers, sequentially by default.
func Add(magnet string) (string, error) {
	return add(magnet, true)
}

func add(magnet string, sequential bool) (string, error) {
	if client == nil {
		return "", fmt.Errorf("torrent engine is not running")
	}
	t, err := client.AddMagnet(magnet)
	if err != nil {
		return "", err
	}
	hash := t.InfoHash().HexString()

	mu.Lock()
	if _, ok := sessions[hash]; ok {
		// already added; keep its settings
		mu.Unlock()
		return hash, nil
	}
	sessions[hash] = &sessionEntry{Magnet: magnet, Sequential: sequential}
	saveSessionLocked()
	mu.Unlock()

	go func() {
		select {
		case <-t.GotInfo():
		case <-t.Closed():
			return
		}
		t.DownloadAll()
		go prioritize(t)
		retryPartFileRenames(t)
	}()
	return hash, nil
}

// SetSequential switches a torrent between sequential (first/last parts
// first, then in order) and normal rarest-first downloading.
func SetSequential(hash string, on bool) error {
	t, err := find(hash)
	if err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	e, ok := sessions[t.InfoHash().HexString()]
	if !ok {
		return fmt.Errorf("torrent %s not found", hash)
	}
	e.Sequential = on
	saveSessionLocked()
	return nil
}

func isSequential(t *torrent.Torrent) bool {
	mu.Lock()
	defer mu.Unlock()
	e, ok := sessions[t.InfoHash().HexString()]
	return ok && e.Sequential
}

// Remove stops a torrent. Downloaded data is kept on disk.
func Remove(hash string) error {
	t, err := find(hash)
	if err != nil {
		return err
	}
	t.Drop()
	mu.Lock()
	delete(sessions, t.InfoHash().HexString())
	saveSessionLocked()
	mu.Unlock()
	return nil
}

const (
	renameCheckEvery = 5 * time.Second
	renameMaxBackoff = 10 * time.Minute
)

// retryPartFileRenames renames finished files that are still "*.part".
// anacrolix renames a file when its last piece verifies, but only logs and
// gives up if that fails, e.g. because another program has the file open on
// Windows. Re-verifying one of the file's pieces makes anacrolix attempt the
// rename again (closing its own handles first), so we do that with
// exponential backoff until no part files are left.
func retryPartFileRenames(t *torrent.Torrent) {
	backoff := map[int]time.Duration{}
	nextTry := map[int]time.Time{}
	tick := time.NewTicker(renameCheckEvery)
	defer tick.Stop()
	for {
		select {
		case <-t.Closed():
			return
		case now := <-tick.C:
			partsLeft := false
			for i, f := range t.Files() {
				part := filepath.Join(dataDir, filepath.FromSlash(f.Path())) + ".part"
				if _, err := os.Stat(part); err != nil {
					continue
				}
				partsLeft = true
				if f.Length() == 0 || f.BytesCompleted() < f.Length() || now.Before(nextTry[i]) {
					continue
				}
				// first retry one tick after completion, then double up to the cap
				d := backoff[i]
				if d == 0 {
					d = renameCheckEvery
				} else if d *= 2; d > renameMaxBackoff {
					d = renameMaxBackoff
				}
				backoff[i] = d
				nextTry[i] = now.Add(d)
				log.Printf("Retrying rename of finished file %s (next retry in %v)", part, d)
				if err := t.Piece(f.EndPieceIndex() - 1).VerifyData(); err != nil {
					log.Printf("Could not re-verify %s: %v", part, err)
				}
			}
			if !partsLeft && t.BytesMissing() == 0 {
				return
			}
		}
	}
}

type FileStatus struct {
	Index     int    `json:"index"`
	Path      string `json:"path"`
	Length    int64  `json:"length"`
	Completed int64  `json:"completed"`
	// Chunks maps the file onto chunkBuckets equal slices, one digit each:
	// 0 = nothing verified .. 9 = fully verified. Only set for the largest
	// file (the video), so the UI can show which parts are playable.
	Chunks string `json:"chunks,omitempty"`
}

const chunkBuckets = 100

type Status struct {
	InfoHash  string       `json:"infoHash"`
	Name      string       `json:"name"`
	HasInfo   bool         `json:"hasInfo"`
	Length    int64        `json:"length"`
	Completed int64        `json:"completed"`
	Peers      int          `json:"peers"`
	Seeders    int          `json:"seeders"`
	Sequential bool         `json:"sequential"`
	Files      []FileStatus `json:"files"`
}

// List returns the status of every torrent in the engine.
func List() []Status {
	if client == nil {
		return nil
	}
	var out []Status
	for _, t := range client.Torrents() {
		out = append(out, statusOf(t))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Get returns the status of one torrent.
func Get(hash string) (Status, error) {
	t, err := find(hash)
	if err != nil {
		return Status{}, err
	}
	return statusOf(t), nil
}

func statusOf(t *torrent.Torrent) Status {
	stats := t.Stats()
	s := Status{
		InfoHash: t.InfoHash().HexString(),
		Name:     t.Name(),
		Peers:      stats.ActivePeers,
		Seeders:    stats.ConnectedSeeders,
		Sequential: isSequential(t),
	}
	if t.Info() == nil {
		return s
	}
	s.HasInfo = true
	s.Length = t.Length()
	s.Completed = t.BytesCompleted()
	largest := -1
	for i, f := range t.Files() {
		s.Files = append(s.Files, FileStatus{
			Index:     i,
			Path:      f.DisplayPath(),
			Length:    f.Length(),
			Completed: f.BytesCompleted(),
		})
		if largest < 0 || f.Length() > s.Files[largest].Length {
			largest = i
		}
	}
	if largest >= 0 {
		s.Files[largest].Chunks = chunkMap(t.Files()[largest])
	}
	return s
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

func find(hash string) (*torrent.Torrent, error) {
	if client == nil {
		return nil, fmt.Errorf("torrent engine is not running")
	}
	var ih metainfo.Hash
	if err := ih.FromHexString(hash); err != nil {
		return nil, fmt.Errorf("invalid info hash %q", hash)
	}
	t, ok := client.Torrent(ih)
	if !ok {
		return nil, fmt.Errorf("torrent %s not found", hash)
	}
	return t, nil
}

func loadSession() []sessionEntry {
	b, err := os.ReadFile(filepath.Join(dataDir, sessionFile))
	if err != nil {
		return nil
	}
	var list []sessionEntry
	if err := json.Unmarshal(b, &list); err != nil {
		log.Println("Could not read torrent session file:", err)
	}
	return list
}

func saveSessionLocked() {
	list := make([]sessionEntry, 0, len(sessions))
	for _, e := range sessions {
		list = append(list, *e)
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	if err := os.WriteFile(filepath.Join(dataDir, sessionFile), b, 0644); err != nil {
		log.Println("Could not save torrent session file:", err)
	}
}
