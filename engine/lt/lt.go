// Package lt wraps libtorrent (rasterbar) through the C shim in shim.h.
// It is mechanism only; the engine package owns the policy.
//
// Build scripts/build-libtorrent.sh once first: it puts the static library
// and headers in third_party/.
package lt

/*
#cgo CPPFLAGS: -I${SRCDIR}/../../third_party/libtorrent/include -I${SRCDIR}/../../third_party/boost
#cgo CPPFLAGS: -DNDEBUG -DTORRENT_NO_DEPRECATE -DBOOST_ASIO_NO_DEPRECATED -DBOOST_ASIO_HAS_STD_CHRONO
#cgo CPPFLAGS: -DBOOST_ASIO_ENABLE_CANCELIO -DBOOST_EXCEPTION_DISABLE
#cgo windows CPPFLAGS: -D_WIN32_WINNT=0x0A00 -DWIN32_LEAN_AND_MEAN
#cgo CXXFLAGS: -O2 -fexceptions
#cgo LDFLAGS: -L${SRCDIR}/../../third_party/libtorrent/lib -ltorrent-rasterbar -lstdc++
#cgo windows LDFLAGS: -lbcrypt -lmswsock -lws2_32 -liphlpapi -lcrypt32
#include <stdlib.h>
#include "shim.h"
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"unsafe"
)

type Settings struct {
	DownloadRateLimit int // bytes/s, 0 = unlimited
	UploadRateLimit   int
	ActiveDownloads   int // -1 = unlimited
	ConnectionsLimit  int
	// Offline opens no sockets and finds no peers; for tests.
	Offline bool
}

type AddParams struct {
	Magnet      string
	TorrentFile string // instead of Magnet (tests)
	// ResumeFile restores the torrent from fast-resume data when it exists;
	// the fields below are then ignored.
	ResumeFile     string
	SavePath       string
	Paused         bool
	Sequential     bool
	UploadMode     bool // connect and get metadata, but download nothing
	MaxConnections int  // -1 = unlimited
	// Carried over when adding a magnet without resume data.
	AddedTime, CompletedTime, TotalDownloaded, TotalUploaded int64
}

// State mirrors libtorrent's torrent_status::state_t.
type State int

const (
	CheckingFiles       State = 1
	DownloadingMetadata State = 2
	Downloading         State = 3
	Finished            State = 4
	Seeding             State = 5
	CheckingResumeData  State = 7
)

type File struct {
	Index  int    `json:"index"`
	Path   string `json:"path"` // relative to the save path; reflects renames
	Size   int64  `json:"size"`
	Offset int64  `json:"offset"` // within the torrent's pieces
	Done   int64  `json:"done"`
}

type Status struct {
	Hash              string  `json:"hash"`
	Name              string  `json:"name"`
	HasMetadata       bool    `json:"hasMetadata"`
	State             State   `json:"state"`
	Paused            bool    `json:"paused"`
	AutoManaged       bool    `json:"autoManaged"`
	UploadMode        bool    `json:"uploadMode"`
	Finished          bool    `json:"finished"`
	TotalWanted       int64   `json:"totalWanted"`
	TotalWantedDone   int64   `json:"totalWantedDone"`
	TotalDone         int64   `json:"totalDone"`
	DownRate          int64   `json:"downRate"` // payload bytes/s
	UpRate            int64   `json:"upRate"`
	NumPeers          int     `json:"numPeers"` // connected, seeds included
	NumSeeds          int     `json:"numSeeds"`
	ListPeers         int     `json:"listPeers"` // known in the swarm
	AllTimeDownload   int64   `json:"allTimeDownload"`
	AllTimeUpload     int64   `json:"allTimeUpload"`
	AddedTime         int64   `json:"addedTime"`
	CompletedTime     int64   `json:"completedTime"`
	DistributedCopies float64 `json:"distributedCopies"` // -1 when not tracked
	NumPieces         int     `json:"numPieces"`         // verified pieces
	PieceCount        int     `json:"pieceCount"`
	PieceLength       int64   `json:"pieceLength"`
	SavePath          string  `json:"savePath"`
	Files             []File  `json:"files"`
	Pieces            string  `json:"pieces"` // "0"/"1" per piece, only when asked for
}

type Event struct {
	Type    string `json:"type"` // metadata, checked, file_completed, file_renamed, file_rename_failed, error
	Hash    string `json:"hash"`
	File    int    `json:"file"`
	Name    string `json:"name"`
	Message string `json:"message"`
}

// ErrClosed is returned by calls on a closed session.
var ErrClosed = errors.New("torrent session is closed")

// Session is safe for concurrent use. Close waits for calls in progress.
type Session struct {
	mu sync.RWMutex // write-locked only by Close
	p  *C.lt_session
}

func cSettings(s Settings) C.lt_settings {
	return C.lt_settings{
		download_rate_limit: C.int(s.DownloadRateLimit),
		upload_rate_limit:   C.int(s.UploadRateLimit),
		active_downloads:    C.int(s.ActiveDownloads),
		connections_limit:   C.int(s.ConnectionsLimit),
		offline:             cBool(s.Offline),
	}
}

func cBool(b bool) C.int {
	if b {
		return 1
	}
	return 0
}

// cErr turns a shim error string into an error and frees it.
func cErr(e *C.char) error {
	if e == nil {
		return nil
	}
	defer C.lt_free(unsafe.Pointer(e))
	return errors.New(C.GoString(e))
}

// cStr converts s for one call; the returned func frees it.
func cStr(s string) (*C.char, func()) {
	p := C.CString(s)
	return p, func() { C.free(unsafe.Pointer(p)) }
}

// New starts a session. stateFile keeps DHT state between runs.
func New(s Settings, stateFile string) (*Session, error) {
	cs := cSettings(s)
	state, free := cStr(stateFile)
	defer free()
	var e *C.char
	p := C.lt_create(&cs, state, &e)
	if p == nil {
		return nil, cErr(e)
	}
	return &Session{p: p}, nil
}

// Close saves the DHT state and shuts the session down.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.p != nil {
		C.lt_destroy(s.p)
		s.p = nil
	}
}

// call runs f with the session pointer while the session is open.
func (s *Session) call(f func(p *C.lt_session) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.p == nil {
		return ErrClosed
	}
	return f(s.p)
}

// onTorrent runs a shim call that takes the torrent's hash.
func (s *Session) onTorrent(hash string, f func(p *C.lt_session, h *C.char) *C.char) error {
	h, free := cStr(hash)
	defer free()
	return s.call(func(p *C.lt_session) error { return cErr(f(p, h)) })
}

func (s *Session) ApplySettings(settings Settings) error {
	cs := cSettings(settings)
	return s.call(func(p *C.lt_session) error {
		C.lt_apply_settings(p, &cs)
		return nil
	})
}

// Add adds a torrent and returns its info hash (40 lowercase hex chars).
func (s *Session) Add(a AddParams) (string, error) {
	magnet, f1 := cStr(a.Magnet)
	defer f1()
	torrentFile, f2 := cStr(a.TorrentFile)
	defer f2()
	resume, f3 := cStr(a.ResumeFile)
	defer f3()
	savePath, f4 := cStr(a.SavePath)
	defer f4()
	cp := C.lt_add_params{
		magnet:           magnet,
		torrent_file:     torrentFile,
		resume_file:      resume,
		save_path:        savePath,
		paused:           cBool(a.Paused),
		sequential:       cBool(a.Sequential),
		upload_mode:      cBool(a.UploadMode),
		max_connections:  C.int(a.MaxConnections),
		added_time:       C.int64_t(a.AddedTime),
		completed_time:   C.int64_t(a.CompletedTime),
		total_downloaded: C.int64_t(a.TotalDownloaded),
		total_uploaded:   C.int64_t(a.TotalUploaded),
	}
	var hash [41]C.char
	err := s.call(func(p *C.lt_session) error { return cErr(C.lt_add(p, &cp, &hash[0])) })
	if err != nil {
		return "", err
	}
	return C.GoString(&hash[0]), nil
}

// Remove drops the torrent; its files stay on disk.
func (s *Session) Remove(hash string) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_remove(p, h) })
}

// SetPaused pauses a torrent outright, or hands it back to the queue.
func (s *Session) SetPaused(hash string, paused bool) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_set_paused(p, h, cBool(paused)) })
}

func (s *Session) SetSequential(hash string, on bool) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_set_sequential(p, h, cBool(on)) })
}

func (s *Session) SetUploadMode(hash string, on bool) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_set_upload_mode(p, h, cBool(on)) })
}

func (s *Session) SetMaxConnections(hash string, n int) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_set_max_connections(p, h, C.int(n)) })
}

// SetPiecePriorities sets the priority (0-7, 4 = normal) of the pieces.
func (s *Session) SetPiecePriorities(hash string, pieces []int, priority int) error {
	if len(pieces) == 0 {
		return nil
	}
	cp := make([]C.int, len(pieces))
	for i, v := range pieces {
		cp[i] = C.int(v)
	}
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char {
		return C.lt_set_piece_priorities(p, h, &cp[0], C.int(len(cp)), C.int(priority))
	})
}

func (s *Session) RenameFile(hash string, file int, name string) error {
	n, free := cStr(name)
	defer free()
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_rename_file(p, h, C.int(file), n) })
}

func (s *Session) ForceRecheck(hash string) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char { return C.lt_force_recheck(p, h) })
}

// Statuses returns every torrent's status.
func (s *Session) Statuses() ([]Status, error) {
	return s.status(nil, false)
}

// Status returns one torrent's status; withPieces adds the piece bitfield.
func (s *Session) Status(hash string, withPieces bool) (Status, error) {
	h, free := cStr(hash)
	defer free()
	list, err := s.status(h, withPieces)
	if err != nil {
		return Status{}, err
	}
	return list[0], nil
}

func (s *Session) status(hash *C.char, withPieces bool) ([]Status, error) {
	var list []Status
	err := s.call(func(p *C.lt_session) error {
		var e *C.char
		js := C.lt_status(p, hash, cBool(withPieces), &e)
		if js == nil {
			return cErr(e)
		}
		defer C.lt_free(unsafe.Pointer(js))
		return json.Unmarshal([]byte(C.GoString(js)), &list)
	})
	return list, err
}

// Events returns what happened since the last call.
func (s *Session) Events() ([]Event, error) {
	var events []Event
	err := s.call(func(p *C.lt_session) error {
		js := C.lt_poll_events(p)
		defer C.lt_free(unsafe.Pointer(js))
		return json.Unmarshal([]byte(C.GoString(js)), &events)
	})
	return events, err
}

// SetDeadlines asks for pieces [first, first+count) in order, the first
// within stepMs, the next within 2*stepMs and so on.
func (s *Session) SetDeadlines(hash string, first, count, stepMs int) error {
	return s.onTorrent(hash, func(p *C.lt_session, h *C.char) *C.char {
		return C.lt_set_deadlines(p, h, C.int(first), C.int(count), C.int(stepMs))
	})
}

// ReadPiece copies a piece into buf, fetching it first with top priority
// when it isn't downloaded yet, and returns its size. It waits until the
// piece arrives or ctx ends.
func (s *Session) ReadPiece(ctx context.Context, hash string, piece int, buf []byte) (int, error) {
	if len(buf) == 0 {
		return 0, errors.New("empty buffer")
	}
	h, free := cStr(hash)
	defer free()
	for {
		var n C.int
		err := s.call(func(p *C.lt_session) error {
			var e *C.char
			n = C.lt_read_piece(p, h, C.int(piece), (*C.char)(unsafe.Pointer(&buf[0])), C.int(len(buf)), 500, &e)
			return cErr(e)
		})
		switch {
		case err != nil:
			return 0, err
		case n >= 0:
			return int(n), nil
		}
		// -2: not here yet
		if err := ctx.Err(); err != nil {
			return 0, err
		}
	}
}

// SaveResume writes <dir>/<hash>.fastresume for every torrent, or only for
// those that changed, and waits for the writes.
func (s *Session) SaveResume(dir string, onlyIfNeeded bool, timeoutMs int) error {
	d, free := cStr(dir)
	defer free()
	return s.call(func(p *C.lt_session) error {
		return cErr(C.lt_save_resume(p, d, cBool(onlyIfNeeded), C.int(timeoutMs)))
	})
}
