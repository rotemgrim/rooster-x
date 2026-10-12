package db

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

// WatchProgress tracks how far through a movie or episode a user got in mpv.
// rooster_id is "movie-<metaDataId>" or "episode-<episodeId>"; each user has
// their own row per rooster_id.
type WatchProgress struct {
	UserID    int64   `json:"-"`
	RoosterID string  `json:"roosterId"`
	Kind      string  `json:"kind"`  // "movie" | "episode" | "" (unknown)
	RefID     int64   `json:"refId"` // numeric metaDataId / episodeId, 0 if unknown
	Path      string  `json:"-"`
	Title     string  `json:"-"`
	Percent   float64 `json:"percent"`
	TimePos   float64 `json:"timePos"`
	Duration  float64 `json:"duration"`
	Finished  bool    `json:"finished"`
	UpdatedAt int64   `json:"updatedAt"`
}

const createWatchProgress = `CREATE TABLE IF NOT EXISTS watchProgress (
			user_id    INTEGER NOT NULL,
			rooster_id TEXT NOT NULL,
			kind       TEXT NOT NULL DEFAULT '',
			ref_id     INTEGER NOT NULL DEFAULT 0,
			path       TEXT,
			title      TEXT,
			percent    REAL NOT NULL DEFAULT 0,
			time_pos   REAL NOT NULL DEFAULT 0,
			duration   REAL NOT NULL DEFAULT 0,
			finished   BOOLEAN NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, rooster_id)
		)`

// EnsureWatchProgressTable creates the watchProgress table on first run, and
// makes the shared one of older versions per user. Safe to run multiple times.
func EnsureWatchProgressTable(db *sql.DB) error {
	if err := splitWatchProgressPerUser(db); err != nil {
		return fmt.Errorf("could not make watch progress per user: %w", err)
	}
	stmts := []string{
		createWatchProgress,
		`CREATE INDEX IF NOT EXISTS idx_watchProgress_user_kind_ref ON watchProgress(user_id, kind, ref_id)`,
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

// splitWatchProgressPerUser turns the shared watchProgress table of older
// versions into a per-user one, giving every user a copy of the progress so
// far.
func splitWatchProgressPerUser(db *sql.DB) error {
	var columns, perUser int
	err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(name = 'user_id'), 0) FROM pragma_table_info('watchProgress')`).
		Scan(&columns, &perUser)
	if err != nil || columns == 0 || perUser > 0 {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`ALTER TABLE watchProgress RENAME TO watchProgress_shared`,
		createWatchProgress,
		`INSERT INTO watchProgress (user_id, rooster_id, kind, ref_id, path, title, percent, time_pos, duration, finished, updated_at)
			SELECT u.id, w.rooster_id, w.kind, w.ref_id, w.path, w.title, w.percent, w.time_pos, w.duration, w.finished, w.updated_at
			FROM watchProgress_shared w CROSS JOIN user u`,
		`DROP TABLE watchProgress_shared`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			return err
		}
	}
	log.Println("✓ watch progress is now per user")
	return tx.Commit()
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
			user_id, rooster_id, kind, ref_id, path, title,
			percent, time_pos, duration, finished, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, rooster_id) DO UPDATE SET
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
		p.UserID, p.RoosterID, p.Kind, p.RefID, p.Path, p.Title,
		p.Percent, p.TimePos, p.Duration, boolToInt(p.Finished), p.UpdatedAt,
	)
	return err
}

const watchProgressColumns = `rooster_id, kind, ref_id, path, title,
	percent, time_pos, duration, finished, updated_at`

// scanWatchProgress reads one row of watchProgressColumns.
func scanWatchProgress(scan func(dest ...interface{}) error) (*WatchProgress, error) {
	var (
		wp          WatchProgress
		path, title sql.NullString
		finished    int
	)
	err := scan(
		&wp.RoosterID, &wp.Kind, &wp.RefID, &path, &title,
		&wp.Percent, &wp.TimePos, &wp.Duration, &finished, &wp.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	wp.Path = path.String
	wp.Title = title.String
	wp.Finished = finished != 0
	return &wp, nil
}

// GetWatchProgress returns the user's latest progress row for the given id,
// or nil if no row exists.
func GetWatchProgress(db *sql.DB, userID int64, roosterID string) (*WatchProgress, error) {
	if roosterID == "" {
		return nil, nil
	}
	wp, err := scanWatchProgress(db.QueryRow(`SELECT `+watchProgressColumns+`
		FROM watchProgress WHERE user_id = ? AND rooster_id = ?`, userID, roosterID).Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return wp, err
}

// GetWatchProgressBulk returns the user's progress rows for the given (kind,
// refIds). Missing rows are simply absent from the returned map. The map key
// is the numeric ref id so the caller can look up by metaDataId / episodeId.
func GetWatchProgressBulk(db *sql.DB, userID int64, kind string, ids []int64) (map[int64]*WatchProgress, error) {
	out := make(map[int64]*WatchProgress)
	if len(ids) == 0 || (kind != "movie" && kind != "episode") {
		return out, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, 0, len(ids)+2)
	args = append(args, userID, kind)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	rows, err := db.Query(`SELECT `+watchProgressColumns+` FROM watchProgress
		WHERE user_id = ? AND kind = ? AND ref_id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		wp, err := scanWatchProgress(rows.Scan)
		if err != nil {
			return nil, err
		}
		out[wp.RefID] = wp
	}
	return out, rows.Err()
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
