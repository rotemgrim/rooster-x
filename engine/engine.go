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
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/metainfo"

	_ "go-poc/engine/classicio" // must run before anacrolix's storage init
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
	// Paused stops all downloading and uploading for the torrent.
	Paused bool `json:"paused,omitempty"`
	// Unix seconds. Torrents added or finished before these were tracked get
	// the time that was first seen.
	AddedAt     int64 `json:"addedAt,omitempty"`
	CompletedAt int64 `json:"completedAt,omitempty"`
	// Resuming a finished torrent restarts its seeding time and ratio limits.
	ResumedAt      int64 `json:"resumedAt,omitempty"`
	ResumeUploaded int64 `json:"resumeUploaded,omitempty"`
	// Payload bytes over all runs, updated every sample.
	Downloaded int64 `json:"downloaded,omitempty"`
	Uploaded   int64 `json:"uploaded,omitempty"`

	live liveState // this run only, never saved
}

type liveState struct {
	t                  *torrent.Torrent
	hash               string
	baseDown, baseUp   int64 // totals from earlier runs
	lastDown, lastUp   int64 // this run's counters at the previous sample
	downSpeed, upSpeed float64
	queued             bool     // held back by the max active downloads setting
	applied            transfer // what reconcileLocked last set on the torrent
}

var (
	client  *torrent.Client
	dataDir string

	// mu guards sessions, dirty and settings.
	mu       sync.Mutex
	sessions = map[string]*sessionEntry{} // infoHash -> entry
	// dirty means the session file is out of date; the sampler writes it.
	dirty bool

	stopSampling = make(chan struct{})
	samplerDone  = make(chan struct{})
)

// Start creates the torrent client, downloading into dir.
func Start(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	dataDir = dir
	loadSettings()
	cfg := torrent.NewDefaultClientConfig()
	cfg.DataDir = dir
	cfg.Seed = true
	cfg.DownloadRateLimiter = downLimiter
	cfg.UploadRateLimiter = upLimiter
	c, err := torrent.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("could not start torrent client: %w", err)
	}
	client = c
	log.Println("Torrent engine downloading to", dir)

	for _, e := range loadSession() {
		if _, err := add(e); err != nil {
			log.Println("Could not resume torrent:", err)
		}
	}
	go sampleLoop()
	return nil
}

// Stop saves the session and closes all connections, flushing piece state.
func Stop() {
	if client == nil {
		return
	}
	close(stopSampling)
	<-samplerDone
	mu.Lock()
	dirty = true // keep this run's transfer totals
	mu.Unlock()
	flushSession()
	client.Close()
}

// Add starts downloading a magnet and returns its info hash. All files are
// downloaded once the metadata arrives from peers.
func Add(magnet string) (string, error) {
	s := GetSettings()
	return add(sessionEntry{Magnet: magnet, Sequential: s.SequentialByDefault, Paused: s.AddPaused})
}

func add(e sessionEntry) (string, error) {
	if client == nil {
		return "", fmt.Errorf("torrent engine is not running")
	}
	t, err := client.AddMagnet(e.Magnet)
	if err != nil {
		return "", err
	}
	hash := t.InfoHash().HexString()

	mu.Lock()
	defer mu.Unlock()
	if _, ok := sessions[hash]; ok {
		return hash, nil // already added; keep its settings
	}
	if e.AddedAt == 0 {
		e.AddedAt = time.Now().Unix()
	}
	e.live = liveState{
		t:        t,
		hash:     hash,
		baseDown: e.Downloaded,
		baseUp:   e.Uploaded,
		applied:  transfer{down: true, up: true}, // anacrolix allows both by default
	}
	sessions[hash] = &e
	t.SetMaxEstablishedConns(maxConns(settings))
	commitLocked()

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
	return update(hash, func(e *sessionEntry) { e.Sequential = on })
}

// SetPaused stops or resumes all data transfer for a torrent.
func SetPaused(hash string, paused bool) error {
	return update(hash, func(e *sessionEntry) {
		e.Paused = paused
		if !paused && isComplete(e.live.t) {
			// seeding limits count from here again
			e.ResumedAt = time.Now().Unix()
			e.ResumeUploaded = e.Uploaded
		}
	})
}

// update changes one torrent's entry and commits the change.
func update(hash string, change func(e *sessionEntry)) error {
	mu.Lock()
	defer mu.Unlock()
	e, err := entryLocked(hash)
	if err != nil {
		return err
	}
	change(e)
	commitLocked()
	return nil
}

// commitLocked brings anacrolix in line with the entries and marks the
// session file for saving. Call with mu held after changing any entry.
func commitLocked() {
	reconcileAllLocked()
	dirty = true
}

func isSequential(t *torrent.Torrent) bool {
	mu.Lock()
	defer mu.Unlock()
	e, ok := sessions[t.InfoHash().HexString()]
	return ok && e.Sequential
}

// isComplete reports whether every piece of the torrent is verified.
func isComplete(t *torrent.Torrent) bool {
	return t.Info() != nil && t.BytesMissing() == 0
}

// entryLocked looks up a torrent by info hash. Call with mu held.
func entryLocked(hash string) (*sessionEntry, error) {
	if e, ok := sessions[strings.ToLower(hash)]; ok {
		return e, nil
	}
	return nil, fmt.Errorf("torrent %s not found", hash)
}

// Remove stops a torrent and, with deleteFiles, deletes everything it
// downloaded (finished and *.part files, then any folders left empty).
func Remove(hash string, deleteFiles bool) error {
	mu.Lock()
	e, err := entryLocked(hash)
	if err == nil {
		delete(sessions, e.live.hash)
		commitLocked() // its queue slot is free now
	}
	mu.Unlock()
	if err != nil {
		return err
	}

	t := e.live.t
	var paths []string
	if deleteFiles && t.Info() != nil {
		for _, f := range t.Files() {
			paths = append(paths, filepath.Join(dataDir, filepath.FromSlash(f.Path())))
		}
	}
	// Drop closes the storage, so no file handles are left open on Windows.
	t.Drop()
	if len(paths) > 0 {
		go deleteWithRetry(paths)
	}
	return nil
}

// deleteWithRetry deletes the files, retrying with backoff while Windows
// reports them in use (e.g. a player still streaming one).
func deleteWithRetry(paths []string) {
	delay := 500 * time.Millisecond
	for attempt := 1; ; attempt++ {
		var failed []string
		for _, p := range paths {
			if err := deleteDownloaded(p); err != nil {
				if attempt == 1 || delay >= 30*time.Second {
					log.Printf("Could not delete %s (attempt %d): %v", p, attempt, err)
				}
				failed = append(failed, p)
			}
		}
		if len(failed) == 0 || delay > time.Minute {
			return
		}
		paths = failed
		time.Sleep(delay)
		delay *= 2
	}
}

// deleteDownloaded removes a torrent file (finished or .part) and then its
// parent folders while they are empty, never leaving dataDir. Paths come
// from torrent metadata sent by peers, so anything outside dataDir is refused.
func deleteDownloaded(path string) error {
	root, err := filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if rel, err := filepath.Rel(root, abs); err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("refusing to delete outside the download folder")
	}
	for _, p := range []string{abs, abs + ".part"} {
		// finished files are marked read-only by anacrolix
		_ = os.Chmod(p, 0644)
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	for dir := filepath.Dir(abs); dir != root && strings.HasPrefix(dir, root); dir = filepath.Dir(dir) {
		if os.Remove(dir) != nil {
			break // not empty (or gone already)
		}
	}
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

// flushSession writes the session file if anything changed. Only the sampler
// (and Stop, after the sampler has exited) call it, so writes never race.
func flushSession() {
	mu.Lock()
	if !dirty {
		mu.Unlock()
		return
	}
	dirty = false
	list := make([]sessionEntry, 0, len(sessions))
	for _, e := range sessions {
		list = append(list, *e)
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	mu.Unlock()
	if err := os.WriteFile(filepath.Join(dataDir, sessionFile), b, 0644); err != nil {
		log.Println("Could not save torrent session file:", err)
	}
}
