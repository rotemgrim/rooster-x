// Package engine embeds a BitTorrent client so RoosterX can download and
// stream torrents itself instead of handing magnets to an external app. The
// client is libtorrent (rasterbar), the library behind qBittorrent, reached
// through the C++ shim in engine/lt; this package owns the policy on top:
// part files, download order, seeding limits and settings.
//
// Files are written as "<name>.part" while downloading and renamed to their
// real name once complete. The walker matches media by extension, so it
// ignores unfinished files and picks them up when the rename happens.
package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go-poc/engine/lt"
)

const (
	// sessionFile lists the torrents with our own per-torrent options.
	sessionFile = ".roosterx-torrents.json"
	// resumeDir holds libtorrent's fast-resume data (progress, metadata,
	// totals, times), one file per torrent.
	resumeDir = ".roosterx-resume"
	// stateFile keeps the DHT state between runs.
	stateFile  = ".roosterx-session"
	partSuffix = ".part"
)

type sessionEntry struct {
	Hash   string `json:"hash,omitempty"`
	Magnet string `json:"magnet"`
	// Sequential downloads the first and last parts of the video first and
	// then the rest in order, so playback can start early.
	Sequential bool `json:"sequential"`
	// Resuming a finished torrent restarts its seeding time and ratio limits.
	ResumedAt      int64 `json:"resumedAt,omitempty"`
	ResumeUploaded int64 `json:"resumeUploaded,omitempty"`

	// Written before libtorrent replaced the anacrolix engine. Read once, to
	// carry a torrent over that has no resume data yet.
	Paused      bool  `json:"paused,omitempty"`
	AddedAt     int64 `json:"addedAt,omitempty"`
	CompletedAt int64 `json:"completedAt,omitempty"`
	Downloaded  int64 `json:"downloaded,omitempty"`
	Uploaded    int64 `json:"uploaded,omitempty"`

	// preparing: added without resume data (a new magnet, or a torrent from
	// the anacrolix engine). It stays in upload mode, connected but
	// downloading nothing, until its files have their part names
	// (pendingRenames in flight) and any data already on disk is rechecked,
	// so an unfinished file never appears under its real name.
	preparing      bool
	pendingRenames int
	recheck        bool // a rename pointed at data already on disk
}

var (
	ses     *lt.Session
	dataDir string

	// mu guards sessions, dirty and settings.
	mu       sync.Mutex
	sessions = map[string]*sessionEntry{} // infoHash -> entry
	// dirty means the session file is out of date; the loop writes it.
	dirty bool

	stopLoop chan struct{}
	loopDone chan struct{}
)

var errNotRunning = errors.New("torrent engine is not running")

// Start creates the torrent client, downloading into dir.
func Start(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, resumeDir), 0755); err != nil {
		return err
	}
	dataDir = dir
	loadSettings()
	s, err := lt.New(ltSettings(settings), filepath.Join(dir, stateFile))
	if err != nil {
		return fmt.Errorf("could not start torrent client: %w", err)
	}
	ses = s
	log.Println("Torrent engine (libtorrent) downloading to", dir)

	for _, e := range loadSession() {
		if _, err := add(e, addOptions{paused: e.Paused}); err != nil {
			log.Println("Could not resume torrent:", err)
		}
	}
	stopLoop, loopDone = make(chan struct{}), make(chan struct{})
	go loop()
	return nil
}

// Stop saves resume data and the session, then shuts the client down.
func Stop() {
	if ses == nil {
		return
	}
	close(stopLoop)
	<-loopDone
	if err := ses.SaveResume(resumePath(""), false, 15000); err != nil {
		log.Println("Could not save torrent resume data:", err)
	}
	flushSession()
	ses.Close()
}

// Add starts downloading a magnet and returns its info hash. All files are
// downloaded once the metadata arrives from peers.
func Add(magnet string) (string, error) {
	s := GetSettings()
	return add(sessionEntry{Magnet: magnet, Sequential: s.SequentialByDefault}, addOptions{paused: s.AddPaused})
}

type addOptions struct {
	paused bool
	// torrentFile adds a .torrent instead of the magnet (tests).
	torrentFile string
}

func add(e sessionEntry, o addOptions) (string, error) {
	if ses == nil {
		return "", errNotRunning
	}
	resume := ""
	if e.Hash != "" {
		resume = resumePath(e.Hash)
	}
	_, statErr := os.Stat(resume)
	hasResume := resume != "" && statErr == nil
	preparing := !hasResume
	hash, err := ses.Add(lt.AddParams{
		Magnet:          e.Magnet,
		TorrentFile:     o.torrentFile,
		ResumeFile:      resume,
		SavePath:        dataDir,
		Paused:          o.paused,
		Sequential:      e.Sequential,
		UploadMode:      preparing,
		MaxConnections:  maxConns(GetSettings()),
		AddedTime:       e.AddedAt,
		CompletedTime:   e.CompletedAt,
		TotalDownloaded: e.Downloaded,
		TotalUploaded:   e.Uploaded,
	})
	if err != nil {
		return "", err
	}
	st, stErr := ses.Status(hash, false)
	// resume data saved mid-preparation (e.g. at shutdown) restores it still
	// in upload mode
	preparing = preparing || (stErr == nil && st.UploadMode)

	mu.Lock()
	if _, ok := sessions[hash]; ok {
		mu.Unlock()
		return hash, nil // already added; keep its settings
	}
	e.Hash, e.preparing = hash, preparing
	if hasResume {
		// libtorrent's resume data holds these now
		e.Paused, e.AddedAt, e.CompletedAt, e.Downloaded, e.Uploaded = false, 0, 0, 0, 0
	}
	sessions[hash] = &e
	dirty = true
	mu.Unlock()

	// a resumed or .torrent add has its metadata already
	if preparing && stErr == nil && st.HasMetadata {
		onMetadata(hash)
	}
	return hash, nil
}

// SetSequential switches a torrent between sequential (first/last parts
// first, then in order) and normal rarest-first downloading.
func SetSequential(hash string, on bool) error {
	if err := update(hash, func(e *sessionEntry) { e.Sequential = on }); err != nil {
		return err
	}
	return applySequential(hash, on)
}

// SetPaused stops all transfers for a torrent, or hands it back to the
// download queue.
func SetPaused(hash string, paused bool) error {
	if ses == nil {
		return errNotRunning
	}
	if err := ses.SetPaused(hash, paused); err != nil {
		return err
	}
	if paused {
		return nil
	}
	st, err := ses.Status(hash, false)
	if err != nil || !st.Finished {
		return err
	}
	// seeding limits count from here again
	return update(hash, func(e *sessionEntry) {
		e.ResumedAt = time.Now().Unix()
		e.ResumeUploaded = st.AllTimeUpload
	})
}

// update changes one torrent's entry and marks the session file for saving.
func update(hash string, change func(e *sessionEntry)) error {
	mu.Lock()
	defer mu.Unlock()
	e, err := entryLocked(hash)
	if err != nil {
		return err
	}
	change(e)
	dirty = true
	return nil
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
	if ses == nil {
		return errNotRunning
	}
	var paths []string
	if deleteFiles {
		if st, err := ses.Status(hash, false); err == nil {
			for _, f := range st.Files {
				paths = append(paths, filepath.Join(st.SavePath, filepath.FromSlash(f.Path)))
			}
		}
	}
	if err := ses.Remove(hash); err != nil {
		return err
	}
	hash = strings.ToLower(hash)
	mu.Lock()
	delete(sessions, hash)
	dirty = true
	mu.Unlock()
	_ = os.Remove(resumePath(hash))

	if len(paths) > 0 {
		go deleteWithRetry(paths)
	}
	return nil
}

// resumePath is a torrent's fast-resume file, or the folder for hash "".
func resumePath(hash string) string {
	if hash == "" {
		return filepath.Join(dataDir, resumeDir)
	}
	return filepath.Join(dataDir, resumeDir, hash+".fastresume")
}

// deleteWithRetry deletes the files, retrying with backoff while Windows
// reports them in use (e.g. a player still streaming one, or libtorrent not
// having closed it yet).
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

// deleteDownloaded removes a torrent file under either name (finished or
// .part) and then its parent folders while they are empty, never leaving
// dataDir. Paths come from torrent metadata sent by peers, so anything
// outside dataDir is refused.
func deleteDownloaded(path string) error {
	root, err := filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(strings.TrimSuffix(path, partSuffix))
	if err != nil {
		return err
	}
	if rel, err := filepath.Rel(root, abs); err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("refusing to delete outside the download folder")
	}
	for _, p := range []string{abs, abs + partSuffix} {
		// files finished by the old anacrolix engine are read-only
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

// flushSession writes the session file if anything changed. Only the loop
// (and Stop, after the loop has exited) call it, so writes never race.
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
