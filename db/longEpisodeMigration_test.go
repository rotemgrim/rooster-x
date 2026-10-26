package db

import (
	"database/sql"
	"testing"
)

func TestLongEpisodesAreMatchedAgain(t *testing.T) {
	conn := memDB(t)
	DB = conn // DropUnused works on DB
	createTablesIfNotExist(conn)
	if _, err := conn.Exec(`PRAGMA user_version = 0;
		INSERT INTO metaData (id, title, tmdbId, series) VALUES (1, 'Some Movie', 10, 0), (2, 'Show', 20, 1);
		INSERT INTO episode (id, metaDataId, season, episode) VALUES (5, 2, 1, 5), (6, 2, 1, 100);
		INSERT INTO mediaFile (id, raw, metaDataId, episodeId) VALUES
			(1, 'Show.S01E100.mkv', 1, NULL),
			(2, 'Show.S01E101.mkv', 0, NULL),
			(3, 'Show.S01E05.mkv', 2, 5),
			(4, 'Show.S01E100.mkv', 2, 6),
			(5, 'Show.S01E102.mkv', NULL, NULL);`); err != nil {
		t.Fatal(err)
	}
	if err := MigrateLongEpisodes(conn); err != nil {
		t.Fatal(err)
	}

	want := map[int64]sql.NullInt64{
		1: {},                      // was on a movie
		2: {},                      // was a failed match
		3: {Int64: 2, Valid: true}, // two-digit episode, untouched
		4: {Int64: 2, Valid: true}, // already on its episode
		5: {},                      // not matched yet
	}
	for id, md := range want {
		var got sql.NullInt64
		if err := conn.QueryRow(`SELECT metaDataId FROM mediaFile WHERE id = ?`, id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != md {
			t.Errorf("mediaFile %d metaDataId = %v, want %v", id, got, md)
		}
	}
	var movies int
	conn.QueryRow(`SELECT COUNT(*) FROM metaData WHERE id = 1`).Scan(&movies)
	if movies != 0 {
		t.Error("the movie the episode was on is left behind")
	}

	// runs once
	if _, err := conn.Exec(`UPDATE mediaFile SET metaDataId = 0 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if err := MigrateLongEpisodes(conn); err != nil {
		t.Fatal(err)
	}
	var again sql.NullInt64
	conn.QueryRow(`SELECT metaDataId FROM mediaFile WHERE id = 1`).Scan(&again)
	if !again.Valid {
		t.Error("ran a second time")
	}
}
