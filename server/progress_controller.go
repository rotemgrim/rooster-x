package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/websocket"

	"go-poc/db"
)

// FinishedThreshold is the percent watched at which we mark a session as
// finished (and won't offer to resume next time).
const FinishedThreshold = 90.0

// mpvTag is the rooster-id an mpv session is started with, which the
// rooster-progress.lua script sends back with every ping: the user and what
// they watch, e.g. "3:movie-1202".
func mpvTag(userID int64, roosterID string) string {
	return fmt.Sprintf("%d:%s", userID, roosterID)
}

// parseMpvTag splits an mpv session's rooster-id into the user and what they
// watch. Sessions started by older versions have no user.
func parseMpvTag(tag string) (userID int64, roosterID string, ok bool) {
	user, roosterID, found := strings.Cut(tag, ":")
	userID, err := strconv.ParseInt(user, 10, 64)
	return userID, roosterID, found && err == nil && roosterID != ""
}

// mpvProgressArgs are the mpv arguments for the user to watch roosterID: the
// tag its progress pings come back with, and where to resume when there is a
// meaningful offset left from an unfinished session.
func mpvProgressArgs(userID int64, roosterID string) []string {
	args := []string{"--script-opts=rooster-id=" + mpvTag(userID, roosterID)}
	wp, err := db.GetWatchProgress(db.DB, userID, roosterID)
	if err != nil {
		log.Println("watchProgress lookup error:", err)
	} else if wp != nil && !wp.Finished && wp.TimePos >= 30 {
		args = append(args, fmt.Sprintf("--start=%.0f", wp.TimePos))
		log.Printf("Resuming MPV id=%s at %.0fs (%.1f%%)", roosterID, wp.TimePos, wp.Percent)
	}
	return args
}

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

	if userID, roosterID, ok := parseMpvTag(p.RoosterID); ok && db.DB != nil {
		finished := p.EOF || p.Percent >= FinishedThreshold
		err := db.UpsertWatchProgress(db.DB, db.WatchProgress{
			UserID:    userID,
			RoosterID: roosterID,
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

// GetWatchProgress returns the current watchProgress row for the given
// {kind, id} (e.g. kind="movie", id=1202) or null if none exists yet.
func (s *Server) GetWatchProgress(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	kind, _ := payload["kind"].(string)
	if kind != "movie" && kind != "episode" {
		transmitPromiseReject(c, req, "invalid kind")
		return
	}
	idF, ok := payload["id"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "id is required")
		return
	}
	roosterID := fmt.Sprintf("%s-%d", kind, int64(idF))
	wp, err := db.GetWatchProgress(db.DB, req.User.ID, roosterID)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("lookup failed: %s", err))
		return
	}
	transmitPromiseResponse(c, req, wp)
}

// GetWatchProgressBulk returns watch progress rows for many ids in one call.
// Payload: { kind: "movie"|"episode", ids: [int, ...] }
// Response: map<refId, progress> (missing ids simply absent).
func (s *Server) GetWatchProgressBulk(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	kind, _ := payload["kind"].(string)
	if kind != "movie" && kind != "episode" {
		transmitPromiseReject(c, req, "invalid kind")
		return
	}
	rawIds, _ := payload["ids"].([]interface{})
	ids := make([]int64, 0, len(rawIds))
	for _, v := range rawIds {
		if f, ok := v.(float64); ok {
			ids = append(ids, int64(f))
		}
	}
	wps, err := db.GetWatchProgressBulk(db.DB, req.User.ID, kind, ids)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("lookup failed: %s", err))
		return
	}
	transmitPromiseResponse(c, req, wps)
}
