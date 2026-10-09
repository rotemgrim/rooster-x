package db

import (
	"database/sql"
	"testing"
)

func TestRatingToAge(t *testing.T) {
	cases := map[string]int64{
		"G": 0, "PG": 7, "PG-13": 13, "R": 17, "NC-17": 18,
		"TV-Y7": 7, "TV-14": 14, "tv-ma": 17,
		"12A": 12, "15": 15, "FSK 16": 16, "MA15+": 15, "R18+": 18, "PG12": 12, "0": 0, "U": 0, "14A": 14,
	}
	for rating, want := range cases {
		got, ok := RatingToAge(rating)
		if !ok || got != want {
			t.Errorf("RatingToAge(%q) = %d, %v; want %d", rating, got, ok, want)
		}
	}
	for _, rating := range []string{"", "NR", "Not Rated", "Unrated", "1990"} {
		if _, ok := RatingToAge(rating); ok {
			t.Errorf("RatingToAge(%q) should be unrated", rating)
		}
	}
}

func TestRatingAgeSQL(t *testing.T) {
	conn, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var allowed int
	err = conn.QueryRow(`SELECT COUNT(*) FROM (SELECT 'PG' r UNION ALL SELECT 'R' UNION ALL SELECT NULL UNION ALL SELECT 'NR')
		WHERE rating_age(r) <= 13`).Scan(&allowed)
	if err != nil {
		t.Fatal(err)
	}
	if allowed != 1 {
		t.Errorf("rows allowed for age 13 = %d, want 1", allowed)
	}
}
