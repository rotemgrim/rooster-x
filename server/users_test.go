package server

import (
	"database/sql"
	"testing"

	"github.com/gorilla/websocket"

	"go-poc/config"
	"go-poc/db"
)

// usersDB swaps in an in-memory database with an admin (1) and a kid limited
// to age 10 (2), and movies rated PG (1), R (2) and unrated (3).
func usersDB(t *testing.T) {
	t.Helper()
	mem, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	mem.SetMaxOpenConns(1) // every connection would get its own :memory: database
	if _, err := mem.Exec(`
		CREATE TABLE user (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName VARCHAR(255) UNIQUE COLLATE NOCASE,
			lastName VARCHAR(255), password TEXT, isAdmin BOOLEAN, maxAge INTEGER);
		CREATE TABLE list (id INTEGER PRIMARY KEY, userId INTEGER);
		CREATE TABLE listItem (id INTEGER PRIMARY KEY, listId INTEGER);
		CREATE TABLE userEpisode (userId INTEGER, episodeId INTEGER);
		CREATE TABLE userMetaData (userId INTEGER, metaDataId INTEGER);
		CREATE TABLE metaData (id INTEGER PRIMARY KEY, ageRating VARCHAR(20));
		CREATE TABLE mediaFile (id INTEGER PRIMARY KEY, metaDataId INTEGER);
		INSERT INTO mediaFile VALUES (10, 1), (20, 2);
		INSERT INTO user (firstName, isAdmin, maxAge) VALUES ('mom', 1, NULL), ('kid', 0, 10);
		INSERT INTO metaData VALUES (1, 'PG'), (2, 'R'), (3, NULL);`); err != nil {
		t.Fatal(err)
	}
	prev := db.DB
	db.DB = mem
	t.Cleanup(func() {
		db.DB = prev
		mem.Close()
	})
}

func TestMayWatchByAge(t *testing.T) {
	usersDB(t)
	for _, c := range []struct {
		user int
		meta int64
		want bool
	}{
		{1, 1, true}, {1, 2, true}, {1, 3, true},
		{2, 1, true}, {2, 2, false}, {2, 3, false},
		{99, 1, false}, // an unknown user only gets all-ages media
	} {
		if got := requestProfile(c.user).mayWatch(c.meta); got != c.want {
			t.Errorf("user %d may watch %d = %v, want %v", c.user, c.meta, got, c.want)
		}
	}
}

func TestUserRoutes(t *testing.T) {
	usersDB(t)
	s := &Server{}
	s.setUserRoutes()
	conn := dialWS(t)
	send := func(userId int, route string, data interface{}) PayloadResponse {
		t.Helper()
		if err := conn.WriteJSON(PayloadRequest{UserId: userId, Route: route, ReplyChannel: route + "#1", Data: data}); err != nil {
			t.Fatal(err)
		}
		return readReply(t, conn)
	}

	if res := send(2, "create-user", map[string]interface{}{"firstName": "sneaky"}); res.Status != StatusFailure {
		t.Fatalf("a non-admin created a user")
	}
	s.onUnlimited("test-downloads", func(c *websocket.Conn, req PayloadRequest) { transmitPromiseResponse(c, req, "ok") })
	t.Cleanup(func() { delete(routes, "test-downloads") })
	if res := send(2, "test-downloads", nil); res.Status != StatusFailure {
		t.Fatalf("a limited profile reached downloads")
	}
	if res := send(1, "test-downloads", nil); res.Status != StatusSuccess {
		t.Fatalf("an unlimited profile was kept from downloads: %v", res.Data)
	}
	ok := func(c *websocket.Conn, req PayloadRequest) { transmitPromiseResponse(c, req, "ok") }
	s.onTitle("test-title", titleField("id"), ok)
	s.onTitle("test-file", titleOfFile, ok)
	t.Cleanup(func() {
		delete(routes, "test-title")
		delete(routes, "test-file")
	})
	for _, c := range []struct {
		route string
		id    int
		want  StatusResponse
	}{
		{"test-title", 1, StatusSuccess}, {"test-title", 2, StatusFailure}, {"test-title", 404, StatusFailure},
		{"test-file", 10, StatusSuccess}, {"test-file", 20, StatusFailure}, {"test-file", 404, StatusFailure},
	} {
		if res := send(2, c.route, map[string]interface{}{"id": c.id}); res.Status != c.want {
			t.Errorf("kid %s %d: %s, want %s", c.route, c.id, res.Status, c.want)
		}
	}
	// the setup wizard creates users before anyone can log in
	RequireSetup(config.Config{})
	res := send(0, "create-user", map[string]interface{}{"firstName": "dad"})
	setup.Lock()
	setup.pending = false
	setup.Unlock()
	if res.Status != StatusSuccess {
		t.Fatalf("the setup wizard could not create a user: %v", res.Data)
	}
	if res := send(0, "create-user", map[string]interface{}{"firstName": "late"}); res.Status != StatusFailure {
		t.Fatalf("anyone could create a user after setup")
	}

	res = send(1, "create-user", map[string]interface{}{"firstName": " teen ", "maxAge": 13})
	if res.Status != StatusSuccess {
		t.Fatalf("create-user: %v", res.Data)
	}
	users := res.Data.([]interface{})
	teen := users[len(users)-1].(map[string]interface{})
	if teen["firstName"] != "teen" || teen["maxAge"] != float64(13) {
		t.Fatalf("created %v", teen)
	}
	if _, ok := teen["password"]; ok {
		t.Fatalf("users are sent with their password")
	}

	if res := send(1, "update-user", map[string]interface{}{"id": 1, "firstName": "mom", "isAdmin": false}); res.Status != StatusFailure {
		t.Fatalf("the last admin lost the admin role")
	}
	if res := send(1, "delete-user", map[string]interface{}{"id": 1}); res.Status != StatusFailure {
		t.Fatalf("the last admin was deleted")
	}
	res = send(1, "update-user", map[string]interface{}{"id": teen["id"], "firstName": "teen", "maxAge": nil})
	if res.Status != StatusSuccess {
		t.Fatalf("update-user: %v", res.Data)
	}
	if requestProfile(int(teen["id"].(float64))).limited() {
		t.Fatalf("clearing the age limit kept it")
	}
	if res := send(1, "delete-user", map[string]interface{}{"id": 2}); res.Status != StatusSuccess || len(res.Data.([]interface{})) != 3 {
		t.Fatalf("delete-user: %v", res.Data)
	}
}
