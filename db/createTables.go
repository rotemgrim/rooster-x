package db

import (
	"database/sql"
	"log"
)

func createTablesIfNotExist(db *sql.DB) {
	createAbsMetaDataTable(db)
	createMetaDataTable(db)
	createAliasTable(db)
	createGenreTable(db)
	createEpisodeTable(db)
	createMediaFileTable(db)
	createTorrentFileTable(db)
	createUserTable(db)
	createUserEpisodeTable(db)
	createUserMetaDataTable(db)
}

func createAbsMetaDataTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS absMetaData (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title VARCHAR(255) COLLATE NOCASE,
		imdbId VARCHAR(40) UNIQUE,
		genres TEXT,
		languages TEXT,
		country TEXT,
		votes INTEGER,
		series BOOLEAN,
		rating REAL,
		runtime INTEGER,
		"year" INTEGER,
		poster TEXT,
		metascore TEXT,
		plot TEXT,
		director VARCHAR,
		writer VARCHAR,
		actors TEXT,
		released VARCHAR(255),
		released_unix INTEGER,
		trailer TEXT
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createMetaDataTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS metaData (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title VARCHAR(255) COLLATE NOCASE,
		imdbId VARCHAR(40) UNIQUE,
		genres TEXT,
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
		status VARCHAR(10) DEFAULT 'not-scanned'
	)`)
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
    title VARCHAR(255) COLLATE NOCASE,
    imdbId VARCHAR(40) UNIQUE,
    genres TEXT,
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
    season INTEGER,
    episode INTEGER,
    imdbSeriesId VARCHAR(255)
)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createGenreTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS genre (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		type VARCHAR(255) UNIQUE
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
		downloadedAt DATETIME,
		FOREIGN KEY (metaDataId) REFERENCES metaData(id),
		FOREIGN KEY (episodeId) REFERENCES episode(id)
	)`)
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
		uploadedAt INTEGER,
		FOREIGN KEY (metaDataId) REFERENCES metaData(id),
  		FOREIGN KEY (episodeId) REFERENCES episode(id)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func createUserTable(db *sql.DB) {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS user (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		firstName VARCHAR(255),
		lastName VARCHAR(255),
		password TEXT,
		isAdmin BOOLEAN
	);
	INSERT INTO user (firstName, lastName, password, isAdmin) VALUES ('admin', 'admin', 'admin', 1);
	`)
	if err != nil {
		log.Fatal(err)
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
