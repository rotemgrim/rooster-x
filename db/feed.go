package db

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"
)

// feed_torrents and feed_folders are pre-computed snapshot tables that hold
// the per-metaData row shape needed by GetMedia for the torrents and folders
// views respectively. They eliminate the cold-cache aggregate cost on every
// request: the heavy GROUP BY over torrentFile / mediaFile is run ONCE per
// sweep, persisted to disk, and the request handler can do a fast indexed
// scan against the snapshot.
//
// Per-user fields (isWatched) and the optional genres filter are NOT
// materialized; they are joined / EXISTS-filtered at request time. Movies/
// series filter is a column on the snapshot (`series`) so it's a one-line
// indexed WHERE.
//
// trendingCount is computed as "torrent rows seen in the last 48h at rebuild
// time" - it's effectively a snapshot value and shifts only when the feed
// is rebuilt (i.e. on each sweep). That's the desired behaviour for a
// browser whose underlying data only changes during sweeps.

// rebuildMu serializes RebuildFeeds calls so a sweep that finishes during
// another rebuild doesn't produce two interleaved transactions.
var rebuildMu sync.Mutex

const trendingWindowSeconds int64 = 48 * 3600

// EnsureFeedTables creates feed_torrents and feed_folders if they don't
// already exist. Idempotent; safe to call on every boot.
func EnsureFeedTables(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS feed_torrents (
			metaDataId    INTEGER PRIMARY KEY,
			title         TEXT,
			votes         INTEGER,
			series        BOOLEAN,
			rating        REAL,
			year          INTEGER,
			poster        TEXT,
			released_unix INTEGER,
			type          TEXT,
			genres        TEXT,
			trendingCount INTEGER,
			-- aggregate columns from torrentFile:
			uploadedAt    TEXT,
			uploadedDate  TEXT,
			mediaFiles    INTEGER,
			resolution    TEXT,
			quality       TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_feed_torrents_series ON feed_torrents(series);

		CREATE TABLE IF NOT EXISTS feed_folders (
			metaDataId     INTEGER PRIMARY KEY,
			title          TEXT,
			votes          INTEGER,
			series         BOOLEAN,
			rating         REAL,
			year           INTEGER,
			poster         TEXT,
			released_unix  INTEGER,
			type           TEXT,
			genres         TEXT,
			trendingCount  INTEGER,
			-- aggregate columns from mediaFile + a touch of torrentFile:
			downloadedAt   TEXT,
			downloadedDate TEXT,
			uploadedDate   TEXT,
			mediaFiles     INTEGER,
			resolution     TEXT,
			quality        TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_feed_folders_series ON feed_folders(series);
	`)
	if err != nil {
		return fmt.Errorf("EnsureFeedTables: %w", err)
	}
	return nil
}

// RebuildFeeds re-populates feed_torrents and feed_folders from the live
// aggregate sources. Safe to call concurrently (serialized via rebuildMu);
// reads-only on source tables, writes only to feed_*.
func RebuildFeeds() {
	rebuildMu.Lock()
	defer rebuildMu.Unlock()

	if DB == nil {
		log.Println("RebuildFeeds: DB not initialised, skipping")
		return
	}

	if err := EnsureFeedTables(DB); err != nil {
		log.Printf("RebuildFeeds: ensure tables failed: %v", err)
		return
	}

	trendingCutoff := time.Now().Unix() - trendingWindowSeconds

	if err := rebuildFeedTorrents(DB, trendingCutoff); err != nil {
		log.Printf("RebuildFeeds: torrents failed: %v", err)
	}
	if err := rebuildFeedFolders(DB, trendingCutoff); err != nil {
		log.Printf("RebuildFeeds: folders failed: %v", err)
	}
}

func rebuildFeedTorrents(db *sql.DB, trendingCutoff int64) error {
	start := time.Now()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM feed_torrents`); err != nil {
		return fmt.Errorf("delete: %w", err)
	}

	// Mirrors the SELECT shape used by message_controller.GetMedia for
	// the torrents branch. Aggregates are built in derived tables so the
	// outer query is one row per metaData.
	const insertSQL = `
		INSERT INTO feed_torrents (
			metaDataId, title, votes, series, rating, year, poster,
			released_unix, type, genres, trendingCount,
			uploadedAt, uploadedDate, mediaFiles, resolution, quality
		)
		SELECT
			md.id,
			md.title,
			md.votes,
			md.series,
			md.rating,
			md.year,
			md.poster,
			md.released_unix,
			md.type,
			gn.genreList,
			IFNULL(tc.tCount, 0),
			sa.uploadedAt,
			sa.uploadedDate,
			sa.mediaFiles,
			IFNULL(sa.resolution, 0),
			IFNULL(sa.quality, '')
		FROM metaData md
		LEFT JOIN (
			SELECT metaDataId, COUNT(*) AS tCount
			FROM torrentFile
			WHERE seenAt > ?
			GROUP BY metaDataId
		) tc ON tc.metaDataId = md.id
		LEFT JOIN (
			SELECT mg.metaDataId, group_concat(g.type, ',') AS genreList
			FROM metaDataGenre mg
			INNER JOIN genre g ON g.id = mg.genreId
			GROUP BY mg.metaDataId
		) gn ON gn.metaDataId = md.id
		LEFT JOIN (
			SELECT metaDataId,
			       DATETIME(max(seenAt), 'unixepoch') AS uploadedAt,
			       DATE(max(seenAt), 'unixepoch')     AS uploadedDate,
			       COUNT(*)                            AS mediaFiles,
			       max(IFNULL(CAST(SUBSTR(resolution, 0) AS int), 0)) AS resolution,
			       rtrim(replace(group_concat(DISTINCT quality||','), ',,', ','), ',') AS quality
			FROM torrentFile
			GROUP BY metaDataId
		) sa ON sa.metaDataId = md.id
	`
	if _, err := tx.Exec(insertSQL, trendingCutoff); err != nil {
		return fmt.Errorf("insert: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	var count int64
	_ = db.QueryRow(`SELECT COUNT(*) FROM feed_torrents`).Scan(&count)
	log.Printf("✓ feed_torrents rebuilt: %d rows in %v", count, time.Since(start))
	return nil
}

func rebuildFeedFolders(db *sql.DB, trendingCutoff int64) error {
	start := time.Now()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM feed_folders`); err != nil {
		return fmt.Errorf("delete: %w", err)
	}

	const insertSQL = `
		INSERT INTO feed_folders (
			metaDataId, title, votes, series, rating, year, poster,
			released_unix, type, genres, trendingCount,
			downloadedAt, downloadedDate, uploadedDate,
			mediaFiles, resolution, quality
		)
		SELECT
			md.id,
			md.title,
			md.votes,
			md.series,
			md.rating,
			md.year,
			md.poster,
			md.released_unix,
			md.type,
			gn.genreList,
			IFNULL(tc.tCount, 0),
			sa.downloadedAt,
			sa.downloadedDate,
			ta.uploadedDate,
			sa.mediaFiles,
			IFNULL(sa.resolution, 0),
			IFNULL(sa.quality, '')
		FROM metaData md
		LEFT JOIN (
			SELECT metaDataId, COUNT(*) AS tCount
			FROM torrentFile
			WHERE seenAt > ?
			GROUP BY metaDataId
		) tc ON tc.metaDataId = md.id
		LEFT JOIN (
			SELECT mg.metaDataId, group_concat(g.type, ',') AS genreList
			FROM metaDataGenre mg
			INNER JOIN genre g ON g.id = mg.genreId
			GROUP BY mg.metaDataId
		) gn ON gn.metaDataId = md.id
		LEFT JOIN (
			SELECT metaDataId,
			       max(downloadedAt) AS downloadedAt,
			       DATE(SUBSTR(max(downloadedAt), 1, 19)) AS downloadedDate,
			       COUNT(*) AS mediaFiles,
			       max(IFNULL(CAST(SUBSTR(resolution, 0) AS int), 0)) AS resolution,
			       rtrim(replace(group_concat(DISTINCT quality||','), ',,', ','), ',') AS quality
			FROM mediaFile
			GROUP BY metaDataId
		) sa ON sa.metaDataId = md.id
		LEFT JOIN (
			SELECT metaDataId, DATE(max(seenAt), 'unixepoch') AS uploadedDate
			FROM torrentFile
			GROUP BY metaDataId
		) ta ON ta.metaDataId = md.id
	`
	if _, err := tx.Exec(insertSQL, trendingCutoff); err != nil {
		return fmt.Errorf("insert: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	var count int64
	_ = db.QueryRow(`SELECT COUNT(*) FROM feed_folders`).Scan(&count)
	log.Printf("✓ feed_folders rebuilt: %d rows in %v", count, time.Since(start))
	return nil
}

// FeedTablesEmpty returns true if either feed table is empty (e.g. fresh
// install). Used to decide whether to do a synchronous rebuild on first
// boot vs a background warmup.
func FeedTablesEmpty() bool {
	if DB == nil {
		return true
	}
	var n int64
	if err := DB.QueryRow(`SELECT COUNT(*) FROM feed_torrents`).Scan(&n); err != nil || n == 0 {
		return true
	}
	if err := DB.QueryRow(`SELECT COUNT(*) FROM feed_folders`).Scan(&n); err != nil || n == 0 {
		return true
	}
	return false
}
