package engine

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/time/rate"
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
	// MaxConnsPerTorrent caps peer connections, 0 = anacrolix's default.
	MaxConnsPerTorrent int `json:"maxConnsPerTorrent"`
	// Options for newly added torrents.
	SequentialByDefault bool `json:"sequentialByDefault"`
	AddPaused           bool `json:"addPaused"`
}

const defaultConnsPerTorrent = 50

var defaultSettings = Settings{SeedDays: 2, SeedEndAction: SeedEndPause, SequentialByDefault: true}

var (
	settings = defaultSettings

	// Our own limiters (anacrolix's default upload limiter is a shared
	// global). The 1 MiB burst must exceed the largest single read/chunk.
	downLimiter = rate.NewLimiter(rate.Inf, 1<<20)
	upLimiter   = rate.NewLimiter(rate.Inf, 1<<20)
)

// GetSettings returns the current settings.
func GetSettings() Settings {
	mu.Lock()
	defer mu.Unlock()
	return settings
}

// SaveSettings applies new settings immediately and stores them.
func SaveSettings(s Settings) error {
	if client == nil {
		return fmt.Errorf("torrent engine is not running")
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

	applyLimits(s)
	mu.Lock()
	settings = s
	for _, e := range sessions {
		e.live.t.SetMaxEstablishedConns(maxConns(s))
	}
	reconcileAllLocked()
	mu.Unlock()

	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(filepath.Join(dataDir, settingsFile), b, 0644)
}

func loadSettings() {
	b, err := os.ReadFile(filepath.Join(dataDir, settingsFile))
	if err == nil {
		// fields missing from older files keep their defaults
		if err := json.Unmarshal(b, &settings); err != nil {
			log.Println("Could not read torrent engine settings:", err)
		}
	}
	applyLimits(settings)
}

func applyLimits(s Settings) {
	downLimiter.SetLimit(kibLimit(s.MaxDownloadKiB))
	upLimiter.SetLimit(kibLimit(s.MaxUploadKiB))
}

func kibLimit(kib int) rate.Limit {
	if kib <= 0 {
		return rate.Inf
	}
	return rate.Limit(kib * 1024)
}

func maxConns(s Settings) int {
	if s.MaxConnsPerTorrent > 0 {
		return s.MaxConnsPerTorrent
	}
	return defaultConnsPerTorrent
}

// seedingDone reports whether a finished torrent reached its seeding time or
// ratio limit. completed is the bytes it has on disk.
func seedingDone(s Settings, e *sessionEntry, completed int64, now time.Time) bool {
	if e.CompletedAt == 0 {
		return false
	}
	if s.SeedDays > 0 {
		since := time.Unix(max(e.CompletedAt, e.ResumedAt), 0)
		if now.Sub(since) >= time.Duration(s.SeedDays*float64(24*time.Hour)) {
			return true
		}
	}
	return s.RatioLimit > 0 && shareRatio(e.Uploaded-e.ResumeUploaded, e.Downloaded, completed) >= s.RatioLimit
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
