package server

import (
	"encoding/json"
	"log"
	"net/http"

	"go-poc/db"
)

// FinishedThreshold is the percent watched at which we mark a session as
// finished (and won't offer to resume next time).
const FinishedThreshold = 90.0

// ProgressPing is the payload posted by the mpv rooster-progress.lua script.
type ProgressPing struct {
	RoosterID string  `json:"rooster_id"`
	Path      string  `json:"path"`
	Title     string  `json:"title"`
	Percent   float64 `json:"percent"`
	TimePos   float64 `json:"time_pos"`
	Duration  float64 `json:"duration"`
	Paused    bool    `json:"paused"`
	EOF       bool    `json:"eof"`
	Reason    string  `json:"reason"`
}

// progressHandler accepts JSON pings from mpv and logs them.
// Endpoint: POST /api/progress
func progressHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var p ProgressPing
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		log.Println("[mpv-progress] decode error:", err)
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	idPart := ""
	if p.RoosterID != "" {
		idPart = " id=" + p.RoosterID
	}
	titlePart := p.Title
	if titlePart == "" {
		titlePart = p.Path
	}
	log.Printf("[mpv-progress] %s%s percent=%.1f%% pos=%.1fs/%.1fs paused=%v title=%q",
		p.Reason, idPart, p.Percent, p.TimePos, p.Duration, p.Paused, titlePart)

	if p.RoosterID != "" && db.DB != nil {
		finished := p.EOF || p.Percent >= FinishedThreshold
		err := db.UpsertWatchProgress(db.DB, db.WatchProgress{
			RoosterID: p.RoosterID,
			Path:      p.Path,
			Title:     p.Title,
			Percent:   p.Percent,
			TimePos:   p.TimePos,
			Duration:  p.Duration,
			Finished:  finished,
		})
		if err != nil {
			log.Println("[mpv-progress] upsert error:", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}
