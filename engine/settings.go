package engine

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/anacrolix/torrent"
	"golang.org/x/time/rate"
)

const settingsFile = ".roosterx-engine.json"

// Settings are the user-adjustable options of the torrent client.
type Settings struct {
	// A finished torrent stops seeding when either limit is reached, counted
	// from when it completed or was last resumed. 0 = no limit.
	SeedDays   float64 `json:"seedDays"`
	RatioLimit float64 `json:"ratioLimit"`
	// SeedEndAction is "pause", or "remove" to drop the torrent from the list
	// and keep its files.
	SeedEndAction string `json:"seedEndAction"`
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

var (
	settings = Settings{SeedDays: 2, SeedEndAction: "pause", SequentialByDefault: true}

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
	if s.SeedEndAction != "remove" {
		s.SeedEndAction = "pause"
	}
	s.MaxDownloadKiB = max(s.MaxDownloadKiB, 0)
	s.MaxUploadKiB = max(s.MaxUploadKiB, 0)
	s.MaxActiveDownloads = max(s.MaxActiveDownloads, 0)
	s.MaxConnsPerTorrent = max(s.MaxConnsPerTorrent, 0)
	mu.Lock()
	settings = s
	mu.Unlock()
	applyLimits(s)
	for _, t := range client.Torrents() {
		t.SetMaxEstablishedConns(maxConns(s))
	}
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

// seedingDone reports whether a finished torrent has reached its seeding
// time or ratio limit. completed is the bytes it has on disk. Call with mu
// held.
func seedingDone(e *sessionEntry, completed int64, now time.Time) bool {
	if e.CompletedAt == 0 {
		return false
	}
	if settings.SeedDays > 0 {
		since := time.Unix(max(e.CompletedAt, e.ResumedAt), 0)
		if now.Sub(since) >= time.Duration(settings.SeedDays*float64(24*time.Hour)) {
			return true
		}
	}
	if settings.RatioLimit > 0 {
		if base := ratioBase(e.Downloaded, completed); base > 0 {
			return float64(e.Uploaded-e.ResumeUploaded)/float64(base) >= settings.RatioLimit
		}
	}
	return false
}

// ratioBase is what the share ratio divides by: the bytes downloaded from
// peers, or the size on disk when the data mostly came from disk
// (qBittorrent does the same).
func ratioBase(downloaded, completed int64) int64 {
	if downloaded < completed/100 {
		return completed
	}
	return downloaded
}

// applyQueue lets only the oldest MaxActiveDownloads unfinished, unpaused
// torrents download and holds the rest as queued.
func applyQueue(unfinished []*torrent.Torrent) {
	var start, stop []*torrent.Torrent
	mu.Lock()
	sort.SliceStable(unfinished, func(i, j int) bool {
		return addedAt(unfinished[i]) < addedAt(unfinished[j])
	})
	active := 0
	for _, t := range unfinished {
		e, ok := sessions[t.InfoHash().HexString()]
		if !ok || e.Paused {
			continue
		}
		queue := settings.MaxActiveDownloads > 0 && active >= settings.MaxActiveDownloads
		if !queue {
			active++
		}
		if queue != e.queued {
			e.queued = queue
			if queue {
				stop = append(stop, t)
			} else {
				start = append(start, t)
			}
		}
	}
	mu.Unlock()
	for _, t := range stop {
		t.DisallowDataDownload()
	}
	for _, t := range start {
		t.AllowDataDownload()
	}
}

// addedAt is for sorting; call with mu held.
func addedAt(t *torrent.Torrent) int64 {
	if e, ok := sessions[t.InfoHash().HexString()]; ok {
		return e.AddedAt
	}
	return 0
}
