package db

import (
	"database/sql"
	"fmt"
	"log"
)

// MigrateAddTorrentImdbId adds an `imdbId` column to torrentFile. apibay
// reports the IMDb id for most torrents, which lets the TMDB step look the
// title up directly instead of searching by the parsed name.
//
// Safe to run multiple times.
func MigrateAddTorrentImdbId(db *sql.DB) error {
	var colCount int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('torrentFile') WHERE name='imdbId'`,
	).Scan(&colCount); err != nil {
		return fmt.Errorf("could not check for imdbId column: %w", err)
	}
	if colCount > 0 {
		return nil
	}
	if _, err := db.Exec(`ALTER TABLE torrentFile ADD COLUMN imdbId TEXT`); err != nil {
		return fmt.Errorf("could not add imdbId column: %w", err)
	}
	log.Println("✓ Added 'imdbId' column to torrentFile")
	return nil
}
