package db

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

// WatchProgress tracks how far through an MPV playback session the user got.
// rooster_id is the canonical key sent by the rooster-progress.lua mpv script
// (formatted as "movie-<metaDataId>" or "episode-<episodeId>").
type WatchProgress struct {
	RoosterID string
	Kind      string // "movie" | "episode" | "" (unknown)
	RefID     int64  // numeric metaDataId / episodeId, 0 if unknown
	Path      string
	Title     string
	Percent   float64
	TimePos   float64
	Duration  float64
	Finished  bool
	UpdatedAt int64
}

// EnsureWatchProgressTable creates the watchProgress table on first run.
// Safe to run multiple times.
func EnsureWatchProgressTable(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS watchProgress (
			rooster_id TEXT PRIMARY KEY,
			kind       TEXT NOT NULL DEFAULT '',
			ref_id     INTEGER NOT NULL DEFAULT 0,
			path       TEXT,
			title      TEXT,
			percent    REAL NOT NULL DEFAULT 0,
			time_pos   REAL NOT NULL DEFAULT 0,
			duration   REAL NOT NULL DEFAULT 0,
			finished   BOOLEAN NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_watchProgress_kind_ref ON watchProgress(kind, ref_id)`,
		`CREATE INDEX IF NOT EXISTS idx_watchProgress_updated ON watchProgress(updated_at DESC)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("could not create watchProgress table (%s): %w", s, err)
		}
	}
	log.Println("✓ watchProgress table ensured")
	return nil
}

// parseRoosterID splits "movie-1202" into ("movie", 1202). Returns ("", 0) if
// the id does not match the expected format.
func parseRoosterID(id string) (string, int64) {
	idx := strings.LastIndex(id, "-")
	if idx <= 0 || idx == len(id)-1 {
		return "", 0
	}
	kind := id[:idx]
	if kind != "movie" && kind != "episode" {
		return "", 0
	}
	n, err := strconv.ParseInt(id[idx+1:], 10, 64)
	if err != nil {
		return "", 0
	}
	return kind, n
}

// UpsertWatchProgress writes (or updates) a watch progress row. The caller
// should pass `finished=true` when the playback has reached end-of-file or
// the percent threshold considered "watched".
func UpsertWatchProgress(db *sql.DB, p WatchProgress) error {
	if p.RoosterID == "" {
		return nil // nothing to track
	}
	if p.Kind == "" || p.RefID == 0 {
		p.Kind, p.RefID = parseRoosterID(p.RoosterID)
	}
	if p.UpdatedAt == 0 {
		p.UpdatedAt = time.Now().Unix()
	}
	_, err := db.Exec(`
		INSERT INTO watchProgress (
			rooster_id, kind, ref_id, path, title,
			percent, time_pos, duration, finished, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(rooster_id) DO UPDATE SET
			kind       = excluded.kind,
			ref_id     = excluded.ref_id,
			path       = excluded.path,
			title      = excluded.title,
			percent    = excluded.percent,
			time_pos   = excluded.time_pos,
			duration   = excluded.duration,
			finished   = excluded.finished OR watchProgress.finished,
			updated_at = excluded.updated_at
	`,
		p.RoosterID, p.Kind, p.RefID, p.Path, p.Title,
		p.Percent, p.TimePos, p.Duration, boolToInt(p.Finished), p.UpdatedAt,
	)
	return err
}

// GetWatchProgress returns the latest progress row for the given id, or nil
// if no row exists.
func GetWatchProgress(db *sql.DB, roosterID string) (*WatchProgress, error) {
	if roosterID == "" {
		return nil, nil
	}
	row := db.QueryRow(`
		SELECT rooster_id, kind, ref_id, path, title,
		       percent, time_pos, duration, finished, updated_at
		FROM watchProgress WHERE rooster_id = ?`, roosterID)
	var (
		wp       WatchProgress
		path     sql.NullString
		title    sql.NullString
		finished int
	)
	err := row.Scan(
		&wp.RoosterID, &wp.Kind, &wp.RefID, &path, &title,
		&wp.Percent, &wp.TimePos, &wp.Duration, &finished, &wp.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	wp.Path = path.String
	wp.Title = title.String
	wp.Finished = finished != 0
	return &wp, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
