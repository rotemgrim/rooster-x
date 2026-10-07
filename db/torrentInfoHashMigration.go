package db

import (
	"database/sql"
	"fmt"
	"log"
)

// MigrateAddTorrentInfoHash adds an `infoHash` column to torrentFile,
// backfills it from existing magnets, removes duplicate rows that share
// the same infohash (keeping the row with the longest magnet — i.e. the
// most trackers — and the lowest id as a tiebreaker), and finally adds
// a UNIQUE index on infoHash so subsequent inserts of the same torrent
// (which arrive from different proxies with slightly different magnet
// URLs) are rejected at the DB level.
//
// Safe to run multiple times.
func MigrateAddTorrentInfoHash(db *sql.DB) error {
	// 1. Add the column if it doesn't exist.
	var colCount int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('torrentFile') WHERE name='infoHash'`,
	).Scan(&colCount); err != nil {
		return fmt.Errorf("could not check for infoHash column: %w", err)
	}
	if colCount == 0 {
		log.Println("Adding 'infoHash' column to torrentFile table...")
		if _, err := db.Exec(`ALTER TABLE torrentFile ADD COLUMN infoHash TEXT COLLATE NOCASE`); err != nil {
			return fmt.Errorf("could not add infoHash column: %w", err)
		}
		log.Println("✓ Added 'infoHash' column to torrentFile")
	}

	// 2. Backfill infoHash for rows that don't have it yet. The btih
	// value sits between "xt=urn:btih:" and the next "&" (or end of
	// string). We compute it inline with SQLite string functions so
	// we don't have to stream every row through Go.
	const backfillSQL = `
		UPDATE torrentFile
		SET infoHash = UPPER(
			CASE
				WHEN instr(substr(magnet, instr(magnet, 'xt=urn:btih:') + 12), '&') = 0
					THEN substr(magnet, instr(magnet, 'xt=urn:btih:') + 12)
				ELSE substr(
					magnet,
					instr(magnet, 'xt=urn:btih:') + 12,
					instr(substr(magnet, instr(magnet, 'xt=urn:btih:') + 12), '&') - 1
				)
			END
		)
		WHERE infoHash IS NULL
		  AND magnet IS NOT NULL
		  AND instr(magnet, 'xt=urn:btih:') > 0
	`
	res, err := db.Exec(backfillSQL)
	if err != nil {
		return fmt.Errorf("could not backfill infoHash: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("✓ Backfilled infoHash on %d torrentFile rows", n)
	}

	// 3. Delete duplicate rows that share the same infoHash. We keep the
	// row with the longest magnet (i.e. the one that carries the most
	// trackers); ties are broken by the lowest id.
	const dedupeSQL = `
		DELETE FROM torrentFile
		WHERE infoHash IS NOT NULL
		  AND id NOT IN (
			SELECT id FROM (
				SELECT id,
					ROW_NUMBER() OVER (
						PARTITION BY infoHash
						ORDER BY length(magnet) DESC, id ASC
					) AS rn
				FROM torrentFile
				WHERE infoHash IS NOT NULL
			)
			WHERE rn = 1
		)
	`
	res, err = db.Exec(dedupeSQL)
	if err != nil {
		return fmt.Errorf("could not dedupe torrentFile by infoHash: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("✓ Removed %d duplicate torrentFile rows (same infoHash)", n)
	}

	// 4. Create the UNIQUE partial index. Partial so rows with NULL
	// infoHash (e.g. unparseable magnets) aren't subject to the
	// constraint.
	if _, err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_torrentFile_infoHash_unique
		   ON torrentFile(infoHash) WHERE infoHash IS NOT NULL`,
	); err != nil {
		return fmt.Errorf("could not create unique infoHash index: %w", err)
	}

	return nil
}
