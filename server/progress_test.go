package server

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-poc/db"
)

func TestMpvTag(t *testing.T) {
	user, roosterID, ok := parseMpvTag(mpvTag(3, "movie-1202"))
	if !ok || user != 3 || roosterID != "movie-1202" {
		t.Fatalf("round trip = %d %q %v", user, roosterID, ok)
	}
	for _, tag := range []string{"", "movie-1202", "x:movie-1202", "3:"} {
		if _, _, ok := parseMpvTag(tag); ok {
			t.Errorf("parseMpvTag(%q) should fail", tag)
		}
	}
}

func TestProgressPingIsSavedForItsUser(t *testing.T) {
	mem, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	mem.SetMaxOpenConns(1) // every connection would get its own :memory: database
	if _, err := mem.Exec(`CREATE TABLE user (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := db.EnsureWatchProgressTable(mem); err != nil {
		t.Fatal(err)
	}
	prev := db.DB
	db.DB = mem
	t.Cleanup(func() {
		db.DB = prev
		mem.Close()
	})

	ping := `{"rooster_id": "` + mpvTag(2, "movie-5") + `", "percent": 40, "time_pos": 1200}`
	rec := httptest.NewRecorder()
	progressHandler(rec, httptest.NewRequest(http.MethodPost, "/api/progress", strings.NewReader(ping)))
	if rec.Code != http.StatusOK {
		t.Fatalf("ping answered %d", rec.Code)
	}
	if wp, err := db.GetWatchProgress(mem, 2, "movie-5"); err != nil || wp == nil || wp.TimePos != 1200 {
		t.Fatalf("user 2 progress = %+v, %v", wp, err)
	}
	if wp, _ := db.GetWatchProgress(mem, 1, "movie-5"); wp != nil {
		t.Fatalf("another user got the progress: %+v", wp)
	}
}

func TestMpvProgressArgsResumeTheUsersSession(t *testing.T) {
	mem, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	mem.SetMaxOpenConns(1) // every connection would get its own :memory: database
	if _, err := mem.Exec(`CREATE TABLE user (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := db.EnsureWatchProgressTable(mem); err != nil {
		t.Fatal(err)
	}
	prev := db.DB
	db.DB = mem
	t.Cleanup(func() {
		db.DB = prev
		mem.Close()
	})
	for _, p := range []db.WatchProgress{
		{UserID: 1, RoosterID: "movie-5", TimePos: 600},
		{UserID: 2, RoosterID: "movie-5", TimePos: 6000, Finished: true},
	} {
		if err := db.UpsertWatchProgress(mem, p); err != nil {
			t.Fatal(err)
		}
	}
	for user, want := range map[int64]string{
		1: "--script-opts=rooster-id=1:movie-5 --start=600",
		2: "--script-opts=rooster-id=2:movie-5", // finished, starts over
		3: "--script-opts=rooster-id=3:movie-5", // never watched
	} {
		if got := strings.Join(mpvProgressArgs(user, "movie-5"), " "); got != want {
			t.Errorf("user %d: %q, want %q", user, got, want)
		}
	}
}
