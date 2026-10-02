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

// Settings are the user-adjustable limits of the torrent client.
type Settings struct {
	// SeedDays stops seeding (pauses) a finished torrent this many days after
	// it completed or was last resumed. 0 seeds forever.
	SeedDays float64 `json:"seedDays"`
	// Speed caps in KiB/s, 0 = unlimited.
	MaxDownloadKiB int `json:"maxDownloadKiB"`
	MaxUploadKiB   int `json:"maxUploadKiB"`
}

var (
	settings = Settings{SeedDays: 2}

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
	s.MaxDownloadKiB = max(s.MaxDownloadKiB, 0)
	s.MaxUploadKiB = max(s.MaxUploadKiB, 0)
	mu.Lock()
	settings = s
	mu.Unlock()
	applyLimits(s)
	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(filepath.Join(dataDir, settingsFile), b, 0644)
}

func loadSettings() {
	b, err := os.ReadFile(filepath.Join(dataDir, settingsFile))
	if err == nil {
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

// seedingExpired reports whether a finished torrent has seeded for the
// configured number of days. Call with mu held.
func seedingExpired(e *sessionEntry, now time.Time) bool {
	if settings.SeedDays <= 0 || e.CompletedAt == 0 {
		return false
	}
	since := max(e.CompletedAt, e.ResumedAt)
	return now.Sub(time.Unix(since, 0)) >= time.Duration(settings.SeedDays*float64(24*time.Hour))
}
