package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"
)

// PeerCountsMaxAge is how long stored seeder/leecher counts are trusted
// before they are refreshed.
const PeerCountsMaxAge = 48 * time.Hour

// MigrateAddTorrentPeerCounts adds seeders / leechers / peersUpdatedAt
// (unix seconds) to torrentFile. Counts come from apibay when a torrent is
// fetched and are refreshed from trackers once they are older than two days.
//
// Safe to run multiple times.
func MigrateAddTorrentPeerCounts(db *sql.DB) error {
	for _, col := range []string{"seeders", "leechers", "peersUpdatedAt"} {
		var n int
		if err := db.QueryRow(
			`SELECT COUNT(*) FROM pragma_table_info('torrentFile') WHERE name = ?`, col,
		).Scan(&n); err != nil {
			return fmt.Errorf("could not check for %s column: %w", col, err)
		}
		if n > 0 {
			continue
		}
		if _, err := db.Exec(`ALTER TABLE torrentFile ADD COLUMN ` + col + ` INTEGER`); err != nil {
			return fmt.Errorf("could not add %s column: %w", col, err)
		}
		log.Printf("✓ Added '%s' column to torrentFile", col)
	}
	return nil
}
