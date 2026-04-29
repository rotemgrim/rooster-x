package server

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"

	"go-poc/db"
)

// List is a user-defined playlist (one per user, can hold any number of
// metaData items, ordered by position).
type List struct {
	ID        int64  `json:"id"`
	UserId    int64  `json:"userId"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	ItemCount int64  `json:"itemCount"`
	// Posters is up to 5 poster paths used to render the stacked-card preview
	// on the lists overview page. The most recently added items come first.
	Posters []string `json:"posters"`
}

// ListItemRow is the per-item shape used by the list-detail view. It carries
// just enough about the underlying metaData to render the row + show watched
// state + (for series) episode-progress.
type ListItemRow struct {
	ID         int64        `json:"id"`
	ListId     int64        `json:"listId"`
	MetaDataId int64        `json:"metaDataId"`
	Position   int64        `json:"position"`
	AddedAt    int64        `json:"addedAt"`
	Title      null.String  `json:"title"`
	Year       null.Int64   `json:"year"`
	Poster     null.String  `json:"poster"`
	Type       null.String  `json:"type"`
	Series     null.Bool    `json:"series"`
	Rating     null.Float64 `json:"rating"`
	IsWatched  null.Bool    `json:"isWatched"`
	// Episode progress (series only). Both 0 for movies.
	EpisodesTotal   int64 `json:"episodesTotal"`
	EpisodesWatched int64 `json:"episodesWatched"`
}

// GetLists returns all lists for the current user with item count and a
// preview slice of up to 5 most-recently-added poster paths.
func (s *Server) GetLists(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	rows, err := db.DB.QueryContext(ctx, `
		SELECT l.id, l.userId, l.name, l.createdAt, l.updatedAt,
		       (SELECT COUNT(*) FROM listItem li WHERE li.listId = l.id) AS itemCount
		FROM list l
		WHERE l.userId = ?
		ORDER BY l.updatedAt DESC
	`, req.UserId)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not query lists: %s", err))
		return
	}
	defer rows.Close()

	var result []List
	for rows.Next() {
		var l List
		if err := rows.Scan(&l.ID, &l.UserId, &l.Name, &l.CreatedAt, &l.UpdatedAt, &l.ItemCount); err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not scan list: %s", err))
			return
		}
		l.Posters = fetchListPosters(ctx, l.ID, int64(req.UserId), 5)
		result = append(result, l)
	}
	if result == nil {
		result = []List{}
	}
	transmitPromiseResponse(c, req, result)
}

func fetchListPosters(ctx context.Context, listId int64, userId int64, limit int) []string {
	// Watched items are pushed to the end of the preview so the stacked
	// poster fan shows what's still unwatched first.
	rows, err := db.DB.QueryContext(ctx, `
		SELECT md.poster
		FROM listItem li
		INNER JOIN metaData md ON md.id = li.metaDataId
		LEFT JOIN userMetaData umd ON umd.metaDataId = md.id AND umd.userId = ?
		WHERE li.listId = ? AND md.poster IS NOT NULL AND md.poster != ''
		ORDER BY COALESCE(umd.isWatched, 0) ASC, li.position ASC
		LIMIT ?
	`, userId, listId, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var posters []string
	for rows.Next() {
		var p sql.NullString
		if err := rows.Scan(&p); err == nil && p.Valid {
			posters = append(posters, p.String)
		}
	}
	return posters
}

// CreateList creates a new (empty) list for the current user.
func (s *Server) CreateList(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	name, _ := payload["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		transmitPromiseReject(c, req, "name is required")
		return
	}

	now := time.Now().Unix()
	res, err := db.DB.Exec(
		`INSERT INTO list (userId, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
		req.UserId, name, now, now,
	)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not create list: %s", err))
		return
	}
	id, _ := res.LastInsertId()
	transmitPromiseResponse(c, req, List{
		ID: id, UserId: int64(req.UserId), Name: name,
		CreatedAt: now, UpdatedAt: now, ItemCount: 0, Posters: []string{},
	})
}

// UpdateList renames a list.
func (s *Server) UpdateList(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["id"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "id is required")
		return
	}
	name, _ := payload["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		transmitPromiseReject(c, req, "name is required")
		return
	}

	now := time.Now().Unix()
	_, err := db.DB.Exec(
		`UPDATE list SET name = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
		name, now, int64(idF), req.UserId,
	)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not update list: %s", err))
		return
	}
	transmitPromiseResponse(c, req, "ok")
}

// DeleteList removes a list and all of its items (cascade).
func (s *Server) DeleteList(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["id"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "id is required")
		return
	}
	tx, err := db.DB.Begin()
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not begin tx: %s", err))
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM listItem WHERE listId = ?`, int64(idF)); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not delete list items: %s", err))
		return
	}
	if _, err := tx.Exec(`DELETE FROM list WHERE id = ? AND userId = ?`, int64(idF), req.UserId); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not delete list: %s", err))
		return
	}
	if err := tx.Commit(); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not commit: %s", err))
		return
	}
	transmitPromiseResponse(c, req, "ok")
}

// GetListItems returns the rows for one list, ordered by position, joined
// with metaData and per-user watched state. For series rows it also computes
// episodes-watched and episodes-total so the client can render a progress bar.
func (s *Server) GetListItems(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["listId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "listId is required")
		return
	}
	listId := int64(idF)

	// Verify the list belongs to this user before returning rows.
	var ownerId int64
	err := db.DB.QueryRow(`SELECT userId FROM list WHERE id = ?`, listId).Scan(&ownerId)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("list not found: %s", err))
		return
	}
	if ownerId != int64(req.UserId) {
		transmitPromiseReject(c, req, "forbidden")
		return
	}

	ctx := context.Background()
	rows, err := db.DB.QueryContext(ctx, `
		SELECT li.id, li.listId, li.metaDataId, li.position, li.addedAt,
		       md.title, md.year, md.poster, md.type, md.series, md.rating,
		       umd.isWatched,
		       COALESCE((SELECT COUNT(*) FROM episode e WHERE e.metaDataId = md.id), 0) AS episodesTotal,
		       COALESCE((SELECT COUNT(*) FROM episode e
		                  INNER JOIN userEpisode ue ON ue.episodeId = e.id
		                  WHERE e.metaDataId = md.id AND ue.userId = ? AND ue.isWatched = 1), 0) AS episodesWatched
		FROM listItem li
		INNER JOIN metaData md ON md.id = li.metaDataId
		LEFT JOIN userMetaData umd ON umd.metaDataId = md.id AND umd.userId = ?
		WHERE li.listId = ?
		ORDER BY li.position ASC
	`, req.UserId, req.UserId, listId)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not query list items: %s", err))
		return
	}
	defer rows.Close()

	var result []ListItemRow
	for rows.Next() {
		var r ListItemRow
		if err := rows.Scan(
			&r.ID, &r.ListId, &r.MetaDataId, &r.Position, &r.AddedAt,
			&r.Title, &r.Year, &r.Poster, &r.Type, &r.Series, &r.Rating,
			&r.IsWatched, &r.EpisodesTotal, &r.EpisodesWatched,
		); err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not scan item: %s", err))
			return
		}
		result = append(result, r)
	}
	if result == nil {
		result = []ListItemRow{}
	}
	transmitPromiseResponse(c, req, result)
}

// AddListItem appends a metaData item to the end of the given list. No-op
// (and returns ok) if the item is already in the list.
func (s *Server) AddListItem(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	listIdF, ok := payload["listId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "listId is required")
		return
	}
	metaIdF, ok := payload["metaDataId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "metaDataId is required")
		return
	}
	listId := int64(listIdF)
	metaDataId := int64(metaIdF)

	// Owner check.
	var ownerId int64
	if err := db.DB.QueryRow(`SELECT userId FROM list WHERE id = ?`, listId).Scan(&ownerId); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("list not found: %s", err))
		return
	}
	if ownerId != int64(req.UserId) {
		transmitPromiseReject(c, req, "forbidden")
		return
	}

	// Append at end: position = max(position)+1.
	var maxPos sql.NullInt64
	_ = db.DB.QueryRow(`SELECT MAX(position) FROM listItem WHERE listId = ?`, listId).Scan(&maxPos)
	nextPos := int64(0)
	if maxPos.Valid {
		nextPos = maxPos.Int64 + 1
	}
	now := time.Now().Unix()

	_, err := db.DB.Exec(
		`INSERT OR IGNORE INTO listItem (listId, metaDataId, position, addedAt) VALUES (?, ?, ?, ?)`,
		listId, metaDataId, nextPos, now,
	)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not add item: %s", err))
		return
	}
	_, _ = db.DB.Exec(`UPDATE list SET updatedAt = ? WHERE id = ?`, now, listId)
	transmitPromiseResponse(c, req, "ok")
}

// RemoveListItem removes a metaData item from a list. Other items keep their
// existing positions (gaps are fine — reorder only writes back full sequences).
func (s *Server) RemoveListItem(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	listIdF, ok := payload["listId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "listId is required")
		return
	}
	metaIdF, ok := payload["metaDataId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "metaDataId is required")
		return
	}
	listId := int64(listIdF)

	var ownerId int64
	if err := db.DB.QueryRow(`SELECT userId FROM list WHERE id = ?`, listId).Scan(&ownerId); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("list not found: %s", err))
		return
	}
	if ownerId != int64(req.UserId) {
		transmitPromiseReject(c, req, "forbidden")
		return
	}

	if _, err := db.DB.Exec(
		`DELETE FROM listItem WHERE listId = ? AND metaDataId = ?`,
		listId, int64(metaIdF),
	); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not remove item: %s", err))
		return
	}
	_, _ = db.DB.Exec(`UPDATE list SET updatedAt = ? WHERE id = ?`, time.Now().Unix(), listId)
	transmitPromiseResponse(c, req, "ok")
}

// ReorderListItems writes back a full ordering for one list. The client
// sends the items' metaDataIds in their new order; we rewrite position 0..N-1.
func (s *Server) ReorderListItems(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	listIdF, ok := payload["listId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "listId is required")
		return
	}
	rawIds, ok := payload["metaDataIds"].([]interface{})
	if !ok {
		transmitPromiseReject(c, req, "metaDataIds is required")
		return
	}
	listId := int64(listIdF)

	var ownerId int64
	if err := db.DB.QueryRow(`SELECT userId FROM list WHERE id = ?`, listId).Scan(&ownerId); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("list not found: %s", err))
		return
	}
	if ownerId != int64(req.UserId) {
		transmitPromiseReject(c, req, "forbidden")
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not begin tx: %s", err))
		return
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE listItem SET position = ? WHERE listId = ? AND metaDataId = ?`)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not prepare: %s", err))
		return
	}
	defer stmt.Close()

	for i, raw := range rawIds {
		idF, ok := raw.(float64)
		if !ok {
			continue
		}
		if _, err := stmt.Exec(int64(i), listId, int64(idF)); err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not write position: %s", err))
			return
		}
	}
	if _, err := tx.Exec(`UPDATE list SET updatedAt = ? WHERE id = ?`, time.Now().Unix(), listId); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not bump updatedAt: %s", err))
		return
	}
	if err := tx.Commit(); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not commit: %s", err))
		return
	}
	transmitPromiseResponse(c, req, "ok")
}

// GetListsContaining returns the ids of the user's lists that already
// contain a given metaData item. Used by the AddToList popup to render
// existing membership without fetching full item rows for each list.
func (s *Server) GetListsContaining(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	metaIdF, ok := payload["metaDataId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "metaDataId is required")
		return
	}

	rows, err := db.DB.Query(`
		SELECT l.id FROM list l
		INNER JOIN listItem li ON li.listId = l.id
		WHERE l.userId = ? AND li.metaDataId = ?
	`, req.UserId, int64(metaIdF))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not query: %s", err))
		return
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	transmitPromiseResponse(c, req, ids)
}
