package db

import (
	"database/sql"
	"fmt"
	"go-poc/ptnutil"
	"log"
)

// MigrateLongEpisodes unlinks the files and torrents of episodes past 99, so
// that the next sweep matches them again. The name parser used to read only
// two-digit episodes, so S01E100 had no episode: it was searched for as a
// movie, and ended up on one or on a failed match.
//
// Runs once: PRAGMA user_version records that it did.
func MigrateLongEpisodes(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("could not read user_version: %w", err)
	}
	if version >= 1 {
		return nil
	}

	unlinked := 0
	left := map[int64][]int64{} // titles to the episodes left on them
	for _, table := range []string{"mediaFile", "torrentFile"} {
		type link struct{ id, metaDataId, episodeId int64 }
		var wrong []link
		// a row on its series' episode is fine; anything else, failed matches
		// (metaDataId 0) among them, is matched again
		rows, err := db.Query(`SELECT f.id, f.raw, f.metaDataId, IFNULL(e.id, 0), IFNULL(md.series, 0)
			FROM ` + table + ` f LEFT JOIN metaData md ON md.id = f.metaDataId
			LEFT JOIN episode e ON e.id = f.episodeId AND e.metaDataId = f.metaDataId
			WHERE f.metaDataId IS NOT NULL`)
		if err != nil {
			return fmt.Errorf("could not look for %s rows of long episodes: %w", table, err)
		}
		for rows.Next() {
			var l link
			var raw sql.NullString
			var series bool
			if err := rows.Scan(&l.id, &raw, &l.metaDataId, &l.episodeId, &series); err != nil {
				rows.Close()
				return fmt.Errorf("could not read a %s row: %w", table, err)
			}
			tor, err := ptnutil.SafeParse(raw.String)
			if err != nil || tor.Season == 0 || tor.Episode < 100 {
				continue
			}
			if !series || l.episodeId == 0 {
				wrong = append(wrong, l)
			}
		}
		rows.Close()

		for _, l := range wrong {
			if _, err := db.Exec(`UPDATE `+table+` SET metaDataId = NULL, episodeId = NULL, status = 'not-scanned', scanError = NULL
				WHERE id = ?`, l.id); err != nil {
				return fmt.Errorf("could not unlink %s %d: %w", table, l.id, err)
			}
			left[l.metaDataId] = append(left[l.metaDataId], l.episodeId)
			unlinked++
		}
	}
	for metaDataId, episodeIds := range left {
		DropUnused(metaDataId, episodeIds)
	}
	if unlinked > 0 {
		log.Printf("✓ Unlinked %d files and torrents of episodes past 99, to be matched again", unlinked)
	}

	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		return fmt.Errorf("could not set user_version: %w", err)
	}
	return nil
}
