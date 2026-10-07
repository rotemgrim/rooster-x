package engine

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"go-poc/engine/lt"
)

const settingsFile = ".roosterx-engine.json"

// SeedEndAction is what happens to a torrent that reached a seeding limit.
type SeedEndAction string

const (
	SeedEndPause  SeedEndAction = "pause"
	SeedEndRemove SeedEndAction = "remove" // drop it from the list, keep the files
)

// Settings are the user-adjustable options of the torrent client.
type Settings struct {
	// A finished torrent stops seeding when either limit is reached, counted
	// from when it completed or was last resumed. 0 = no limit.
	SeedDays      float64       `json:"seedDays"`
	RatioLimit    float64       `json:"ratioLimit"`
	SeedEndAction SeedEndAction `json:"seedEndAction"`
	// Speed caps in KiB/s, 0 = unlimited.
	MaxDownloadKiB int `json:"maxDownloadKiB"`
	MaxUploadKiB   int `json:"maxUploadKiB"`
	// MaxActiveDownloads queues unfinished torrents beyond this many, oldest
	// first. 0 = unlimited.
	MaxActiveDownloads int `json:"maxActiveDownloads"`
	// MaxConnsPerTorrent caps peer connections, 0 = defaultConnsPerTorrent.
	MaxConnsPerTorrent int `json:"maxConnsPerTorrent"`
	// Options for newly added torrents.
	SequentialByDefault bool `json:"sequentialByDefault"`
	AddPaused           bool `json:"addPaused"`
}

const (
	// qBittorrent's defaults
	defaultConnsPerTorrent = 100
	totalConnections       = 500
)

var defaultSettings = Settings{SeedDays: 2, SeedEndAction: SeedEndPause, SequentialByDefault: true}

var settings = defaultSettings

// GetSettings returns the current settings.
func GetSettings() Settings {
	mu.Lock()
	defer mu.Unlock()
	return settings
}

// SaveSettings applies new settings immediately and stores them.
func SaveSettings(s Settings) error {
	if ses == nil {
		return errNotRunning
	}
	s.SeedDays = max(s.SeedDays, 0)
	s.RatioLimit = max(s.RatioLimit, 0)
	if s.SeedEndAction != SeedEndRemove {
		s.SeedEndAction = SeedEndPause
	}
	s.MaxDownloadKiB = max(s.MaxDownloadKiB, 0)
	s.MaxUploadKiB = max(s.MaxUploadKiB, 0)
	s.MaxActiveDownloads = max(s.MaxActiveDownloads, 0)
	s.MaxConnsPerTorrent = max(s.MaxConnsPerTorrent, 0)

	mu.Lock()
	settings = s
	hashes := make([]string, 0, len(sessions))
	for hash := range sessions {
		hashes = append(hashes, hash)
	}
	mu.Unlock()
	if err := ses.ApplySettings(ltSettings(s)); err != nil {
		return err
	}
	for _, hash := range hashes {
		_ = ses.SetMaxConnections(hash, maxConns(s))
	}

	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(filepath.Join(dataDir, settingsFile), b, 0644)
}

func loadSettings() {
	b, err := os.ReadFile(filepath.Join(dataDir, settingsFile))
	if err != nil {
		return
	}
	// fields missing from older files keep their defaults
	if err := json.Unmarshal(b, &settings); err != nil {
		log.Println("Could not read torrent engine settings:", err)
	}
}

// ltSettings translates the session-wide settings for libtorrent.
func ltSettings(s Settings) lt.Settings {
	active := s.MaxActiveDownloads
	if active == 0 {
		active = -1
	}
	return lt.Settings{
		DownloadRateLimit: s.MaxDownloadKiB * 1024,
		UploadRateLimit:   s.MaxUploadKiB * 1024,
		ActiveDownloads:   active,
		ConnectionsLimit:  totalConnections,
	}
}

func maxConns(s Settings) int {
	if s.MaxConnsPerTorrent > 0 {
		return s.MaxConnsPerTorrent
	}
	return defaultConnsPerTorrent
}

// seedStats are the inputs of the seeding limits for one torrent.
type seedStats struct {
	CompletedAt, ResumedAt int64 // unix seconds
	Downloaded, Uploaded   int64 // all-time payload bytes
	ResumeUploaded         int64 // Uploaded when last resumed
	Completed              int64 // bytes on disk
}

// seedingDone reports whether a finished torrent reached its seeding time or
// ratio limit.
func seedingDone(s Settings, t seedStats, now time.Time) bool {
	if t.CompletedAt == 0 {
		return false
	}
	if s.SeedDays > 0 {
		since := time.Unix(max(t.CompletedAt, t.ResumedAt), 0)
		if now.Sub(since) >= time.Duration(s.SeedDays*float64(24*time.Hour)) {
			return true
		}
	}
	return s.RatioLimit > 0 && shareRatio(t.Uploaded-t.ResumeUploaded, t.Downloaded, t.Completed) >= s.RatioLimit
}

// shareRatio is uploaded / downloaded, dividing by the size on disk instead
// when the data mostly came from disk rather than peers (as qBittorrent
// does).
func shareRatio(uploaded, downloaded, completed int64) float64 {
	base := downloaded
	if downloaded < completed/100 {
		base = completed
	}
	if base <= 0 {
		return 0
	}
	return float64(uploaded) / float64(base)
}
