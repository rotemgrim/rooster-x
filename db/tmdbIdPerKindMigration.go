package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"go-poc/ptnutil"
	"log"
	"regexp"
	"strings"
)

// uniqueTmdbId finds the old metaData schema, where a TMDB id was unique.
var uniqueTmdbId = regexp.MustCompile(`(?i)\btmdbId\s+INTEGER\s+UNIQUE\b`)

// MigrateTmdbIdPerKind makes a TMDB id unique per kind instead of over all of
// metaData. TMDB numbers movies and series apart, so movie 246 (Zatoichi) and
// series 246 (Avatar: The Last Airbender) are different titles; with tmdbId
// unique the series could not be saved, and its episodes were linked to the
// movie instead.
//
// The first time, it rebuilds metaData without the old UNIQUE, and unlinks the
// files and torrents that ended up on a title of the wrong kind, or on an
// episode of another title, so that the next sweep matches them again.
//
// Safe to run multiple times.
func MigrateTmdbIdPerKind(db *sql.DB) error {
	var ddl string
	if err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'metaData'`).Scan(&ddl); err != nil {
		return fmt.Errorf("could not read the metaData table: %w", err)
	}
	if uniqueTmdbId.MatchString(ddl) {
		log.Println("Rebuilding metaData so a movie and a series can share a TMDB id...")
		if err := rebuildMetaData(db); err != nil {
			return fmt.Errorf("could not rebuild metaData: %w", err)
		}
		log.Println("✓ Rebuilt metaData")
		unlinkWrongKind(db)
		unlinkStrayEpisodes(db)
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_metaData_tmdbId_series ON metaData(tmdbId, series)`); err != nil {
		return fmt.Errorf("could not create the tmdbId index: %w", err)
	}
	return nil
}

// rebuildMetaData copies metaData into a table made by metaDataTableSQL, the
// way SQLite changes a constraint: the other tables reference metaData by name,
// so with foreign keys off for the copy they reference the new table once it
// takes the name.
func rebuildMetaData(db *sql.DB) error {
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	// foreign keys can only be turned off outside a transaction
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var columns []string
	rows, err := tx.QueryContext(ctx, `SELECT name FROM pragma_table_info('metaData')`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		columns = append(columns, `"`+name+`"`)
	}
	rows.Close()

	// the indexes go with the old table, so they are made again on the new one
	var indexes []string
	rows, err = tx.QueryContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'metaData' AND sql IS NOT NULL`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var index string
		if err := rows.Scan(&index); err != nil {
			rows.Close()
			return err
		}
		indexes = append(indexes, index)
	}
	rows.Close()

	// so that the ids of deleted titles are not given out again
	var seq sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT seq FROM sqlite_sequence WHERE name = 'metaData'`).Scan(&seq)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	cols := strings.Join(columns, ", ")
	stmts := []string{
		`DROP TABLE IF EXISTS metaData_new`,
		metaDataTableSQL("metaData_new"),
		`INSERT INTO metaData_new (` + cols + `) SELECT ` + cols + ` FROM metaData`,
		`DROP TABLE metaData`,
		`ALTER TABLE metaData_new RENAME TO metaData`,
	}
	for _, stmt := range append(stmts, indexes...) {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	if seq.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE sqlite_sequence SET seq = ? WHERE name = 'metaData' AND seq < ?`, seq.Int64, seq.Int64); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// unlinkWrongKind unlinks the files and torrents linked to a movie while their
// name is of an episode, or to a series while it is not: the title of the
// other kind with the same TMDB id took the place of theirs. What they leave
// behind is dropped, unless someone watched, marked or listed it.
func unlinkWrongKind(db *sql.DB) {
	unlinked := 0
	left := map[int64][]int64{} // titles to the episodes left on them
	for _, table := range []string{"mediaFile", "torrentFile"} {
		type link struct{ id, metaDataId, episodeId int64 }
		var wrong []link
		// only an episode of the title is left behind on it; old versions linked
		// episodes of other titles (see unlinkStrayEpisodes), which stay
		rows, err := db.Query(`SELECT f.id, f.raw, f.metaDataId, IFNULL(e.id, 0), IFNULL(md.series, 0)
			FROM ` + table + ` f JOIN metaData md ON md.id = f.metaDataId
			LEFT JOIN episode e ON e.id = f.episodeId AND e.metaDataId = f.metaDataId`)
		if err != nil {
			log.Printf("could not look for %s rows on a title of the wrong kind: %v", table, err)
			continue
		}
		for rows.Next() {
			var l link
			var raw sql.NullString
			var series bool
			if err := rows.Scan(&l.id, &raw, &l.metaDataId, &l.episodeId, &series); err != nil {
				log.Printf("could not read a %s row: %v", table, err)
				continue
			}
			tor, err := ptnutil.SafeParse(raw.String)
			if err != nil {
				continue
			}
			// the rule matching goes by to search for a series or a movie
			if episode := tor.Season > 0 && tor.Episode > 0; episode != series {
				wrong = append(wrong, l)
			}
		}
		rows.Close()

		for _, l := range wrong {
			if _, err := db.Exec(`UPDATE `+table+` SET metaDataId = NULL, episodeId = NULL, status = 'not-scanned', scanError = NULL
				WHERE id = ?`, l.id); err != nil {
				log.Printf("could not unlink %s %d: %v", table, l.id, err)
				continue
			}
			left[l.metaDataId] = append(left[l.metaDataId], l.episodeId)
			unlinked++
		}
	}
	for metaDataId, episodeIds := range left {
		DropUnused(metaDataId, episodeIds)
	}
	if unlinked > 0 {
		log.Printf("✓ Unlinked %d files and torrents from titles of the wrong kind, to be matched again", unlinked)
	}
}

// unlinkStrayEpisodes clears episode links to episodes of another title. Old
// versions stored the episode number of a torrent as its episode id, so
// S02E10 was linked to episode row 10, whatever title that belongs to. A file
// on a series needs its episode, so those are matched again; on a movie the
// link only goes.
func unlinkStrayEpisodes(db *sql.DB) {
	const stray = `episodeId > 0 AND NOT EXISTS
		(SELECT 1 FROM episode e WHERE e.id = %[1]s.episodeId AND e.metaDataId = %[1]s.metaDataId)`
	for _, table := range []string{"mediaFile", "torrentFile"} {
		where := fmt.Sprintf(stray, table)
		res, err := db.Exec(`UPDATE ` + table + ` SET metaDataId = NULL, episodeId = NULL, status = 'not-scanned', scanError = NULL
			WHERE metaDataId IN (SELECT id FROM metaData WHERE series = 1) AND ` + where)
		if err != nil {
			log.Printf("could not unlink %s rows from episodes of other series: %v", table, err)
			continue
		}
		rematch, _ := res.RowsAffected()
		res, err = db.Exec(`UPDATE ` + table + ` SET episodeId = NULL WHERE ` + where)
		if err != nil {
			log.Printf("could not clear %s links to episodes of other titles: %v", table, err)
			continue
		}
		cleared, _ := res.RowsAffected()
		if rematch+cleared > 0 {
			log.Printf("✓ %s: %d linked to an episode of another title, %d of them to be matched again", table, rematch+cleared, rematch)
		}
	}
}

// DropUnused deletes the episodes and the title that wrong matches leave
// behind when they were the only things linked to them. Whatever a user has
// watched, marked or listed is kept, so is everything a file is still linked to.
func DropUnused(metaDataId int64, episodeIds []int64) {
	ctx := context.Background()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("could not drop what the wrong match left: %v", err)
		return
	}
	defer tx.Rollback()

	const unusedEpisode = `DELETE FROM episode WHERE id = ?
		AND NOT EXISTS (SELECT 1 FROM mediaFile WHERE episodeId = episode.id)
		AND NOT EXISTS (SELECT 1 FROM torrentFile WHERE episodeId = episode.id)
		AND NOT EXISTS (SELECT 1 FROM userEpisode WHERE episodeId = episode.id)
		AND NOT EXISTS (SELECT 1 FROM watchProgress WHERE kind = 'episode' AND ref_id = episode.id)`
	for _, id := range episodeIds {
		if id == 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, unusedEpisode, id); err != nil {
			log.Printf("could not drop episode %d: %v", id, err)
			return
		}
	}

	if metaDataId != 0 {
		const unused = `NOT EXISTS (SELECT 1 FROM mediaFile WHERE metaDataId = ?)
			AND NOT EXISTS (SELECT 1 FROM torrentFile WHERE metaDataId = ?)
			AND NOT EXISTS (SELECT 1 FROM episode WHERE metaDataId = ?)
			AND NOT EXISTS (SELECT 1 FROM listItem WHERE metaDataId = ?)
			AND NOT EXISTS (SELECT 1 FROM userMetaData WHERE metaDataId = ?)
			AND NOT EXISTS (SELECT 1 FROM watchProgress WHERE kind = 'movie' AND ref_id = ?)`
		args := []interface{}{metaDataId, metaDataId, metaDataId, metaDataId, metaDataId, metaDataId, metaDataId}
		for _, stmt := range []string{
			`DELETE FROM alias WHERE metaDataId = ? AND ` + unused,
			`DELETE FROM metaDataGenre WHERE metaDataId = ? AND ` + unused,
			`DELETE FROM metaData WHERE id = ? AND ` + unused,
		} {
			if _, err := tx.ExecContext(ctx, stmt, args...); err != nil {
				log.Printf("could not drop metadata %d: %v", metaDataId, err)
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("could not drop what the wrong match left: %v", err)
	}
}
