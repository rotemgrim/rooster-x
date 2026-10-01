package db

import (
	"database/sql"
	"log"
)

func createTablesIfNotExist(db *sql.DB) {
	createMetaDataTable(db)
	createAliasTable(db)
	createGenreTable(db)
	createEpisodeTable(db)
	createMediaFileTable(db)
	createTorrentFileTable(db)
	createUserTable(db)
	createUserEpisodeTable(db)
	createUserMetaDataTable(db)

	// Run migration to many-to-many genres (safe to run multiple times)
	if err := MigrateToManyToManyGenres(db); err != nil {
		log.Printf("Warning: Genre migration failed: %v", err)
		// Don't fatal - allow app to continue with old schema
	}

	// Add network column to existing metaData tables (safe to run multiple times)
	if err := MigrateAddNetworkColumn(db); err != nil {
		log.Printf("Warning: network column migration failed: %v", err)
	}

	// Add tagline/backdrop/status/ageRating columns (safe to run multiple times)
	if err := MigrateAddExtraMetaColumns(db); err != nil {
		log.Printf("Warning: extra metaData columns migration failed: %v", err)
	}

	// Rename status->productionStatus and add enrichState/enrichedAt
	if err := MigrateRenameStatusAndAddEnrich(db); err != nil {
		log.Printf("Warning: enrichment columns migration failed: %v", err)
	}

	// Composite indexes used by GetMedia (trendingCount + max-aggregates).
	if err := MigrateAddPerfIndexes(db); err != nil {
		log.Printf("Warning: perf indexes migration failed: %v", err)
	}

	// Adds torrentFile.infoHash + UNIQUE index and de-duplicates rows
	// whose magnets differ only in tracker list / dn= encoding.
	if err := MigrateAddTorrentInfoHash(db); err != nil {
		log.Printf("Warning: torrent infoHash migration failed: %v", err)
	}

	if err := MigrateAddTorrentImdbId(db); err != nil {
		log.Printf("Warning: torrent imdbId migration failed: %v", err)
	}

	if err := MigrateAddTorrentPeerCounts(db); err != nil {
		log.Printf("Warning: torrent peer counts migration failed: %v", err)
	}

	// Snapshot tables for the torrents/folders views (materialised on sweep).
	if err := EnsureFeedTables(db); err != nil {
		log.Printf("Warning: feed tables creation failed: %v", err)
	}

	// User-defined lists (per-user playlists of metaData items).
	if err := EnsureListTables(db); err != nil {
		log.Printf("Warning: list tables creation failed: %v", err)
	}

	// MPV watch progress (resume + tracking).
	if err := EnsureWatchProgressTable(db); err != nil {
		log.Printf("Warning: watchProgress table creation failed: %v", err)
	}
}

func createMetaDataTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS metaData (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title VARCHAR(255) COLLATE NOCASE,
		imdbId VARCHAR(40) UNIQUE,
		tmdbId INTEGER UNIQUE,
		languages TEXT,
		country TEXT,
		votes INTEGER,
		series BOOLEAN,
		rating REAL,
		runtime INTEGER,
		year INTEGER,
		poster TEXT,
		metascore TEXT,
		plot TEXT,
		director VARCHAR,
		writer VARCHAR,
		actors TEXT,
		released VARCHAR(255),
		released_unix INTEGER,
		trailer TEXT,
		type VARCHAR(40),
		name VARCHAR(255),
		network TEXT,
		tagline TEXT,
		backdrop TEXT,
		productionStatus VARCHAR(40),
		ageRating VARCHAR(20),
		enrichState VARCHAR(20),
		enrichedAt INTEGER
	);
		CREATE INDEX IF NOT EXISTS idx_type ON metaData(type);
		CREATE INDEX IF NOT EXISTS idx_tmdbId ON metaData(tmdbId);
		CREATE INDEX IF NOT EXISTS idx_imdbId ON metaData(imdbId);`)
	if err != nil {
		log.Fatal(err)
	}
}

func createAliasTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS alias (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		alias VARCHAR(255) COLLATE NOCASE UNIQUE,
		realTitle VARCHAR(255) COLLATE NOCASE,
		metaDataId INTEGER,
		FOREIGN KEY (metaDataId) REFERENCES metaData(id)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createEpisodeTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS episode (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
	metaDataId INTEGER,
    title VARCHAR(255) COLLATE NOCASE,
    tmdbId INTEGER UNIQUE,
    votes INTEGER,
    series BOOLEAN,
    rating REAL,
    runtime INTEGER,
    year INTEGER,
    poster TEXT,
    metascore TEXT,
    plot TEXT,
    director VARCHAR,
    writer VARCHAR,
    actors TEXT,
    released VARCHAR(255),
    released_unix INTEGER,
    trailer TEXT,
    season INTEGER,
    episode INTEGER,
    imdbSeriesId VARCHAR(255),
    tmdbSeriesId INTEGER,
	FOREIGN KEY (metaDataId) REFERENCES metaData(id)
);  CREATE INDEX IF NOT EXISTS idx_metaDataId ON episode(metaDataId);
	CREATE INDEX IF NOT EXISTS idx_tmdbSeriesId ON episode(tmdbSeriesId);
	CREATE INDEX IF NOT EXISTS idx_imdbSeriesId ON episode(imdbSeriesId);
	CREATE INDEX IF NOT EXISTS idx_season ON episode(season DESC);
	CREATE INDEX IF NOT EXISTS idx_episode ON episode(episode DESC);
`)
	if err != nil {
		log.Fatal(err)
	}
}

func createGenreTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS genre (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		type VARCHAR(255) UNIQUE,
		count INTEGER
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createMediaFileTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS mediaFile (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		raw TEXT,
		path TEXT COLLATE NOCASE UNIQUE,
		hash VARCHAR(40),
		size INTEGER,
		metaDataId INTEGER,
		episodeId INTEGER,
		status VARCHAR(10) DEFAULT 'not-scanned',
		scanError TEXT,
		year INTEGER,
		resolution VARCHAR(40),
		quality VARCHAR(40),
		codec VARCHAR(40),
		audio VARCHAR(40),
		"group" VARCHAR(40),
		region VARCHAR(40),
		language VARCHAR(40),
		extended BOOLEAN DEFAULT 0,
		hardcoded BOOLEAN DEFAULT 0,
		proper BOOLEAN DEFAULT 0,
		repack BOOLEAN DEFAULT 0,
		wideScreen BOOLEAN DEFAULT 0,
		downloadedAt DATETIME,
		FOREIGN KEY (metaDataId) REFERENCES metaData(id),
		FOREIGN KEY (episodeId) REFERENCES episode(id)
	);`)
	if err != nil {
		log.Fatal(err)
	}

	// Create indexes separately to ensure they're created
	_, err = db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_mediaFile_metaDataId ON mediaFile(metaDataId);
		CREATE INDEX IF NOT EXISTS idx_mediaFile_status ON mediaFile(status);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func createTorrentFileTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS torrentFile (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		raw TEXT,
		title TEXT,
		magnet TEXT COLLATE NOCASE UNIQUE,
		infoHash TEXT COLLATE NOCASE,
		size INTEGER,
		status VARCHAR(10) DEFAULT 'not-scanned',
		scanError TEXT,
		metaDataId INTEGER,
		episodeId INTEGER,
		year INTEGER,
		resolution VARCHAR(40),
		quality VARCHAR(40),
		codec VARCHAR(40),
		audio VARCHAR(40),
		"group" VARCHAR(40),
		region VARCHAR(40),
		language VARCHAR(40),
		extended BOOLEAN DEFAULT 0,
		hardcoded BOOLEAN DEFAULT 0,
		proper BOOLEAN DEFAULT 0,
		repack BOOLEAN DEFAULT 0,
		wideScreen BOOLEAN DEFAULT 0,
		uploadedAt DATETIME,
		seenAt INTEGER,
		FOREIGN KEY (metaDataId) REFERENCES metaData(id),
  		FOREIGN KEY (episodeId) REFERENCES episode(id)
	);`)
	if err != nil {
		log.Fatal(err)
	}

	// Create indexes separately to ensure they're created
	_, err = db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_torrentFile_metaDataId ON torrentFile(metaDataId);
		CREATE INDEX IF NOT EXISTS idx_torrentFile_seenAt ON torrentFile(seenAt DESC);
		CREATE INDEX IF NOT EXISTS idx_torrentFile_episodeId ON torrentFile(episodeId DESC);
		CREATE INDEX IF NOT EXISTS idx_torrentFile_uploadedAt ON torrentFile(uploadedAt DESC);
	`)

	if err != nil {
		log.Fatal(err)
	}
}

func createUserTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS user (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		firstName VARCHAR(255) UNIQUE COLLATE NOCASE,
		lastName VARCHAR(255),
		password TEXT,
		isAdmin BOOLEAN
	);
	INSERT INTO user (firstName, lastName, password, isAdmin) VALUES ('admin', 'admin', 'admin', 1);
	`)
	if err != nil {
		//log.Fatal(err)
	}
}

func createUserEpisodeTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS userEpisode (
		userId INTEGER,
		episodeId INTEGER,
		isWatched BOOLEAN,
		FOREIGN KEY (userId) REFERENCES user(id),
		FOREIGN KEY (episodeId) REFERENCES episode(id),
		PRIMARY KEY (userId, episodeId)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createUserMetaDataTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS userMetaData (
		userId INTEGER,
		metaDataId INTEGER,
		isWatched BOOLEAN,
		FOREIGN KEY (userId) REFERENCES user(id),
		FOREIGN KEY (metaDataId) REFERENCES metaData(id),
		PRIMARY KEY (userId, metaDataId)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}
