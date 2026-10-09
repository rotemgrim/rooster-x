package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"

	"go-poc/db"
	"go-poc/models"
)

// Users have no passwords: whoever opens the app picks a profile. A profile
// with an age limit only sees media rated for that age (never unrated media)
// and has no downloads. The client says which user it is, so this keeps
// kids to their own profile, not anyone determined to get around it.

const errNotForProfile = "Not available on this profile"

type profile struct {
	ID        int64  `json:"id"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	IsAdmin   bool   `json:"isAdmin"`
	// Only media rated for this age or younger; nil for no limit.
	MaxAge *int64 `json:"maxAge"`
}

func toProfile(u *models.User) profile {
	return profile{u.ID.Int64, u.FirstName.String, u.LastName.String, u.IsAdmin.Bool, u.MaxAge.Ptr()}
}

// requestProfile is who a request comes from. An unknown user gets the
// strictest limit.
func requestProfile(userId int) profile {
	u, err := models.FindUser(context.Background(), db.DB, null.Int64From(int64(userId)))
	if err != nil {
		var allAges int64
		return profile{ID: int64(userId), MaxAge: &allAges}
	}
	return toProfile(u)
}

func (p profile) limited() bool {
	return p.MaxAge != nil
}

// ageFilter is a SQL condition on an ageRating expression that passes only
// media the profile may see: everything without an age limit, and only media
// rated at or under the limit with one (rating_age is NULL for unrated media).
func (p profile) ageFilter(ageRating string) (string, []interface{}) {
	return "(? IS NULL OR rating_age(" + ageRating + ") <= ?)", []interface{}{p.MaxAge, p.MaxAge}
}

// mayWatch tells whether the profile may see a movie or series.
func (p profile) mayWatch(metaDataId int64) bool {
	cond, args := p.ageFilter("ageRating")
	var n int
	err := db.DB.QueryRow(`SELECT COUNT(*) FROM metaData WHERE id = ? AND `+cond,
		append([]interface{}{metaDataId}, args...)...).Scan(&n)
	return err == nil && n > 0
}

func listUsers() ([]profile, error) {
	users, err := models.Users(qm.OrderBy("id")).All(context.Background(), db.DB)
	if err != nil {
		return nil, err
	}
	result := make([]profile, 0, len(users))
	for _, u := range users {
		result = append(result, toProfile(u))
	}
	return result, nil
}

// saveUser creates the user, or updates it when it has an id.
func saveUser(p profile) error {
	p.FirstName = strings.TrimSpace(p.FirstName)
	p.LastName = strings.TrimSpace(p.LastName)
	if p.FirstName == "" {
		return errors.New("Enter a name")
	}
	if p.MaxAge != nil && (*p.MaxAge < 0 || *p.MaxAge > 21) {
		return errors.New("Pick an age limit between 0 and 21")
	}
	err := inTx(func(ctx context.Context, tx *sql.Tx) error {
		user := &models.User{Password: null.StringFrom("")}
		if p.ID != 0 {
			var err error
			if user, err = models.FindUser(ctx, tx, null.Int64From(p.ID)); err != nil {
				return errors.New("That user no longer exists")
			}
			if !p.IsAdmin {
				if err := keepAnAdmin(tx, p.ID); err != nil {
					return err
				}
			}
		}
		user.FirstName = null.StringFrom(p.FirstName)
		user.LastName = null.StringFrom(p.LastName)
		user.IsAdmin = null.BoolFrom(p.IsAdmin)
		user.MaxAge = null.Int64FromPtr(p.MaxAge)
		if p.ID == 0 {
			return user.Insert(ctx, tx, boil.Infer())
		}
		_, err := user.Update(ctx, tx, boil.Infer())
		return err
	})
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return fmt.Errorf("There is already a user named %s", p.FirstName)
	}
	return err
}

// deleteUser removes a user and everything that belongs to them, keeping at
// least one admin.
func deleteUser(id int64) error {
	return inTx(func(ctx context.Context, tx *sql.Tx) error {
		if err := keepAnAdmin(tx, id); err != nil {
			return err
		}
		for _, stmt := range []string{
			`DELETE FROM listItem WHERE listId IN (SELECT id FROM list WHERE userId = ?)`,
			`DELETE FROM list WHERE userId = ?`,
			`DELETE FROM userEpisode WHERE userId = ?`,
			`DELETE FROM userMetaData WHERE userId = ?`,
			`DELETE FROM user WHERE id = ?`,
		} {
			if _, err := tx.ExecContext(ctx, stmt, id); err != nil {
				return fmt.Errorf("could not delete user: %w", err)
			}
		}
		return nil
	})
}

// keepAnAdmin refuses to take away the last admin, by deleting it or by
// removing its admin role.
func keepAnAdmin(tx *sql.Tx, id int64) error {
	var last bool
	err := tx.QueryRow(`SELECT isAdmin = 1 AND NOT EXISTS (SELECT 1 FROM user WHERE isAdmin = 1 AND id != ?)
		FROM user WHERE id = ?`, id, id).Scan(&last)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err == nil && last {
		return errors.New("Keep at least one admin")
	}
	return err
}

// inTx runs fn in a transaction, committing only when it succeeds.
func inTx(fn func(ctx context.Context, tx *sql.Tx) error) error {
	ctx := context.Background()
	tx, err := db.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(ctx, tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// onAdmin registers a route only admins may use. While setup is pending
// nobody can log in yet and the setup wizard creates the users, so it is
// open to everyone, like the rest of the setup.
func (s *Server) onAdmin(route string, callback func(*websocket.Conn, PayloadRequest)) {
	s.on(route, func(c *websocket.Conn, req PayloadRequest) {
		if !req.User.IsAdmin && !setupPending() {
			transmitPromiseReject(c, req, "Only an admin can do this")
			return
		}
		callback(c, req)
	})
}

// onUnlimited registers a route that profiles with an age limit may not use.
func (s *Server) onUnlimited(route string, callback func(*websocket.Conn, PayloadRequest)) {
	s.on(route, func(c *websocket.Conn, req PayloadRequest) {
		if req.User.limited() {
			transmitPromiseReject(c, req, errNotForProfile)
			return
		}
		callback(c, req)
	})
}

// onTitle registers a route about one movie or series, which titleOf reads
// from the request, that only profiles allowed to see it may use.
func (s *Server) onTitle(route string, titleOf func(PayloadRequest) (int64, bool), callback func(*websocket.Conn, PayloadRequest)) {
	s.on(route, func(c *websocket.Conn, req PayloadRequest) {
		metaDataId, ok := titleOf(req)
		if !ok {
			transmitPromiseReject(c, req, "not found")
			return
		}
		if !req.User.mayWatch(metaDataId) {
			transmitPromiseReject(c, req, errNotForProfile)
			return
		}
		callback(c, req)
	})
}

// titleField reads the title a request is about from one of its data fields.
func titleField(field string) func(PayloadRequest) (int64, bool) {
	return func(req PayloadRequest) (int64, bool) {
		data, _ := req.Data.(map[string]interface{})
		id, ok := data[field].(float64)
		return int64(id), ok
	}
}

// titleOfFile reads the title of the media file a request is about.
func titleOfFile(req PayloadRequest) (int64, bool) {
	fileId, ok := titleField("id")(req)
	if !ok {
		return 0, false
	}
	var metaDataId sql.NullInt64
	err := db.DB.QueryRow(`SELECT metaDataId FROM mediaFile WHERE id = ?`, fileId).Scan(&metaDataId)
	return metaDataId.Int64, err == nil && metaDataId.Valid
}

func (s *Server) setUserRoutes() {
	s.on("get-all-users", s.GetAllUsers)
	s.onAdmin("create-user", s.SaveUser)
	s.onAdmin("update-user", s.SaveUser)
	s.onAdmin("delete-user", s.DeleteUser)
}

func (s *Server) GetAllUsers(c *websocket.Conn, req PayloadRequest) {
	s.replyUsers(c, req)
}

// SaveUser creates a user, or updates one when the data has an id.
func (s *Server) SaveUser(c *websocket.Conn, req PayloadRequest) {
	var p profile
	if err := decodeData(req, &p); err != nil {
		transmitPromiseReject(c, req, "invalid user")
		return
	}
	if err := saveUser(p); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	s.replyUsers(c, req)
}

func (s *Server) DeleteUser(c *websocket.Conn, req PayloadRequest) {
	var data struct {
		ID int64 `json:"id"`
	}
	if err := decodeData(req, &data); err != nil {
		transmitPromiseReject(c, req, "invalid user")
		return
	}
	if err := deleteUser(data.ID); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	s.replyUsers(c, req)
}

func (s *Server) replyUsers(c *websocket.Conn, req PayloadRequest) {
	users, err := listUsers()
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get users: %v", err))
		return
	}
	transmitPromiseResponse(c, req, users)
}
