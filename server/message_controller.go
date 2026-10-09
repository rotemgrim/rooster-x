package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"

	"go-poc/db"
	"go-poc/models"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jamesnetherton/m3u"
	"github.com/skratchdot/open-golang/open"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

type StatusResponse string // "success", "failure", "msg", or "chunk"
const (
	StatusMsg     StatusResponse = "msg"
	StatusSuccess StatusResponse = "success"
	StatusFailure StatusResponse = "failure"
	StatusChunk   StatusResponse = "chunk"
)

type PayloadResponse struct {
	ReplyChannel string         `json:"replyChannel"`
	Status       StatusResponse `json:"status"`
	Data         interface{}    `json:"data"`
}

type MsgResponse struct {
	Status StatusResponse `json:"status"`
	Data   interface{}    `json:"data"`
}

// MediaDataExtended is the slim row shape returned by GetMedia for the grid
// view. It contains only fields needed for rendering cards, plus the columns
// used by client-side sort/group/filter (year, rating, votes, released_unix,
// genres, isWatched, mediaFileCount, resolution, quality, uploadedAt,
// downloadedAt, trendingCount, etc.).
//
// Heavy fields used only by the details panel (plot, actors, director,
// writer, tagline, backdrop, trailer, released, metascore, imdbId, tmdbId,
// languages, country, network, productionStatus, ageRating, name, runtime,
// enrichState, enrichedAt) are intentionally omitted to keep the payload
// small. The detail panel fetches the full record via the get-meta-data
// route when a card is opened.
type MediaDataExtended struct {
	ID             null.Int64   `boil:"id" json:"id,omitempty" toml:"id" yaml:"id,omitempty"`
	Title          null.String  `boil:"title" json:"title,omitempty" toml:"title" yaml:"title,omitempty"`
	Genres         null.String  `boil:"genres" json:"genres,omitempty" toml:"genres" yaml:"genres,omitempty"`
	Votes          null.Int64   `boil:"votes" json:"votes,omitempty" toml:"votes" yaml:"votes,omitempty"`
	Series         null.Bool    `boil:"series" json:"series,omitempty" toml:"series" yaml:"series,omitempty"`
	Rating         null.Float64 `boil:"rating" json:"rating,omitempty" toml:"rating" yaml:"rating,omitempty"`
	Year           null.Int64   `boil:"year" json:"year,omitempty" toml:"year" yaml:"year,omitempty"`
	Poster         null.String  `boil:"poster" json:"poster,omitempty" toml:"poster" yaml:"poster,omitempty"`
	ReleasedUnix   null.Int64   `boil:"released_unix" json:"released_unix,omitempty" toml:"released_unix" yaml:"released_unix,omitempty"`
	Type           null.String  `boil:"type" json:"type,omitempty" toml:"type" yaml:"type,omitempty"`
	IsWatched      null.Bool    `boil:"isWatched" json:"isWatched,omitempty"`
	DownloadedAt   null.String  `boil:"downloadedAt" json:"downloadedAt,omitempty"`
	UploadedAt     null.String  `boil:"uploadedAt" json:"uploadedAt,omitempty"`
	MediaFileCount null.Int     `boil:"mediaFiles" json:"mediaFileCount,omitempty"`
	Quality        null.String  `boil:"quality" json:"quality,omitempty"`
	Resolution     null.String  `boil:"resolution" json:"resolution,omitempty"`
	UploadedDate   null.String  `boil:"uploadedDate" json:"uploadedDate,omitempty"`
	DownloadedDate null.String  `boil:"downloadedDate" json:"downloadedDate,omitempty"`
	TrendingCount  null.Int     `boil:"trendingCount" json:"trendingCount,omitempty"`
}

// FullSweep starts a sweep of the media folders; progress arrives as messages.
func (s *Server) FullSweep(c *websocket.Conn, data PayloadRequest) {
	if walker, _ := s.sweepers(); walker != nil {
		go walker.FullSweep()
	}
	transmitPromiseResponse(c, data, "started")
}

// SyncTorrents starts a torrent sync; progress arrives as messages.
func (s *Server) SyncTorrents(c *websocket.Conn, data PayloadRequest) {
	if _, fetcher := s.sweepers(); fetcher != nil {
		go fetcher.FullSweep()
	}
	transmitPromiseResponse(c, data, "started")
}

func (s *Server) GetAllUsers(c *websocket.Conn, data PayloadRequest) {
	ctx := context.Background()
	users, err := models.Users().All(ctx, db.DB)
	if err != nil {
		transmitPromiseReject(c, data, fmt.Sprintf("could not get users: %v", err))
		return
	}
	transmitPromiseResponse(c, data, users)
}

func (s *Server) GetAllMedia(c *websocket.Conn, req PayloadRequest) {
	isTorrents := req.Data.(map[string]interface{})["isTorrents"]
	genres := req.Data.(map[string]interface{})["genres"]

	var genreList []string
	if genres != nil {
		if genresSlice, ok := genres.([]interface{}); ok {
			for _, g := range genresSlice {
				if genreStr, ok := g.(string); ok {
					genreList = append(genreList, genreStr)
				}
			}
		}
	}

	s.GetMedia(c, req, isTorrents.(bool), genreList)
}

// scanMediaRowPtrs returns a slice of pointers (one per column) used by
// rows.Scan to populate a MediaDataExtended directly, by column name. Unknown
// columns are routed to a discard sink so this is robust to small SELECT
// shape changes (e.g. uploadedDate vs downloadedDate that differ between the
// torrents and folders branches of GetMedia).
func scanMediaRowPtrs(cols []string, m *MediaDataExtended, discard *interface{}) []interface{} {
	ptrs := make([]interface{}, len(cols))
	for i, col := range cols {
		switch col {
		case "id":
			ptrs[i] = &m.ID
		case "title":
			ptrs[i] = &m.Title
		case "votes":
			ptrs[i] = &m.Votes
		case "series":
			ptrs[i] = &m.Series
		case "rating":
			ptrs[i] = &m.Rating
		case "year":
			ptrs[i] = &m.Year
		case "poster":
			ptrs[i] = &m.Poster
		case "released_unix":
			ptrs[i] = &m.ReleasedUnix
		case "type":
			ptrs[i] = &m.Type
		case "isWatched":
			ptrs[i] = &m.IsWatched
		case "downloadedAt":
			ptrs[i] = &m.DownloadedAt
		case "uploadedAt":
			ptrs[i] = &m.UploadedAt
		case "mediaFiles":
			ptrs[i] = &m.MediaFileCount
		case "quality":
			ptrs[i] = &m.Quality
		case "resolution":
			ptrs[i] = &m.Resolution
		case "uploadedDate":
			ptrs[i] = &m.UploadedDate
		case "downloadedDate":
			ptrs[i] = &m.DownloadedDate
		case "trendingCount":
			ptrs[i] = &m.TrendingCount
		case "genres":
			ptrs[i] = &m.Genres
		default:
			ptrs[i] = discard
		}
	}
	return ptrs
}

func (s *Server) GetMedia(c *websocket.Conn, data PayloadRequest, isTorrents bool, genres []string) {
	var userId int = data.UserId

	// Read from the materialised feed_torrents / feed_folders snapshot
	// tables (rebuilt on every sweep). The heavy GROUP BY over torrentFile
	// / mediaFile happens once per sweep instead of once per request, so
	// the request is now a plain indexed scan + 1:1 userMetaData LEFT JOIN.
	//
	// Per-user state (isWatched) is NOT in the snapshot - it joins at
	// request time. The genres EXISTS filter also stays at request time so
	// a single snapshot serves all variants; movies/series is filtered on
	// the client.

	feedTable := "feed_folders"
	viewSelect := "f.downloadedAt as downloadedAt, f.downloadedDate as downloadedDate, f.uploadedDate as uploadedDate"
	if isTorrents {
		feedTable = "feed_torrents"
		viewSelect = "f.uploadedAt as uploadedAt, f.uploadedDate as uploadedDate"
	}

	var (
		sb      strings.Builder
		sqlArgs []interface{}
	)
	sb.WriteString("SELECT f.metaDataId as id, f.title, f.votes, f.series, f.rating, ")
	sb.WriteString("f.year, f.poster, f.released_unix, f.type, f.genres, f.trendingCount, ")
	sb.WriteString("f.mediaFiles as mediaFiles, f.resolution as resolution, f.quality as quality, ")
	sb.WriteString(viewSelect)
	sb.WriteString(", umd.isWatched as isWatched ")
	sb.WriteString("FROM ")
	sb.WriteString(feedTable)
	sb.WriteString(" f ")
	sb.WriteString("LEFT JOIN userMetaData umd ON umd.metaDataId = f.metaDataId AND umd.userId = ? ")
	sqlArgs = append(sqlArgs, userId)

	// WHERE clauses
	whereParts := []string{}
	if len(genres) > 0 {
		log.Printf("Filtering by %d genre(s): %v", len(genres), genres)
		placeholders := make([]string, len(genres))
		for i, g := range genres {
			placeholders[i] = "?"
			sqlArgs = append(sqlArgs, strings.ToLower(strings.TrimSpace(g)))
		}
		whereParts = append(whereParts, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM metaDataGenre mg INNER JOIN genre g ON g.id = mg.genreId `+
				`WHERE mg.metaDataId = f.metaDataId AND LOWER(g.type) IN (%s))`,
			strings.Join(placeholders, ","),
		))
	}
	if len(whereParts) > 0 {
		sb.WriteString("WHERE ")
		sb.WriteString(strings.Join(whereParts, " AND "))
	}

	// No ORDER BY: the client re-sorts the dataset based on user-chosen
	// orderConfig.orderBy. Letting SQLite stream rows in their natural
	// (PK) order means rows can flow as soon as they're scanned - no
	// temp-table materialisation before the first row.

	sqlStr := sb.String()

	// Create context with timeout to prevent hanging queries
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	queryStart := time.Now()
	rows, err := db.DB.QueryContext(ctx, sqlStr, sqlArgs...)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("⚠ Query timeout after 30s (torrents: %v, genres: %v)", isTorrents, genres)
			transmitPromiseReject(c, data, "Query timed out - too complex. Try fewer filters or wait for database optimization.")
		} else {
			log.Printf("Query error: %v", err)
			transmitPromiseReject(c, data, fmt.Sprintf("could not get media:\n%s\n\nquery: %s", err, sqlStr))
		}
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		transmitPromiseReject(c, data, fmt.Sprintf("could not read column metadata: %s", err))
		return
	}

	const batchSize = 200
	batch := make([]MediaDataExtended, 0, batchSize)
	total := 0
	var firstRowAt time.Time
	streamStart := time.Now()
	var discard interface{}

	for rows.Next() {
		var m MediaDataExtended
		ptrs := scanMediaRowPtrs(cols, &m, &discard)
		if err := rows.Scan(ptrs...); err != nil {
			log.Printf("Row scan error: %v", err)
			transmitPromiseReject(c, data, fmt.Sprintf("could not scan row: %s", err))
			return
		}
		if total == 0 {
			firstRowAt = time.Now()
		}
		batch = append(batch, m)
		total++
		if len(batch) >= batchSize {
			if err := transmitPromiseChunk(c, data, batch); err != nil {
				return // connection error
			}
			batch = make([]MediaDataExtended, 0, batchSize)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		transmitPromiseReject(c, data, fmt.Sprintf("rows iteration failed: %s", err))
		return
	}

	// Flush trailing batch (if any).
	if len(batch) > 0 {
		if err := transmitPromiseChunk(c, data, batch); err != nil {
			return
		}
	}

	if total == 0 {
		log.Printf("✓ Returned 0 results in %v (torrents: %v, genres: %v)", time.Since(queryStart), isTorrents, genres)
		transmitPromiseResponse(c, data, []MediaDataExtended{})
		return
	}

	ttfr := firstRowAt.Sub(queryStart)
	totalElapsed := time.Since(streamStart)
	log.Printf("✓ Streamed %d results (torrents: %v, genres: %v) | ttfr=%v total=%v",
		total, isTorrents, genres, ttfr, totalElapsed)
	// Final success message signals end-of-stream to the client.
	transmitPromiseResponse(c, data, map[string]interface{}{
		"streamed": true,
		"total":    total,
	})
}

// GetMetaDataById returns the full metadata record (including detail-only
// fields like plot, actors, tagline, backdrop, trailer, imdbId, etc.) for a
// single id. Used by the details panel which the slim list payload doesn't
// cover.
func (s *Server) GetMetaDataById(c *websocket.Conn, req PayloadRequest) {
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
	id := int64(idF)

	type fullMeta struct {
		ID               null.Int64   `boil:"id" json:"id,omitempty"`
		Title            null.String  `boil:"title" json:"title,omitempty"`
		ImdbId           null.String  `boil:"imdbId" json:"imdbId,omitempty"`
		TMDBID           null.Int64   `boil:"tmdbId" json:"tmdbId,omitempty"`
		Languages        null.String  `boil:"languages" json:"languages,omitempty"`
		Country          null.String  `boil:"country" json:"country,omitempty"`
		Votes            null.Int64   `boil:"votes" json:"votes,omitempty"`
		Series           null.Bool    `boil:"series" json:"series,omitempty"`
		Rating           null.Float64 `boil:"rating" json:"rating,omitempty"`
		Runtime          null.Int64   `boil:"runtime" json:"runtime,omitempty"`
		Year             null.Int64   `boil:"year" json:"year,omitempty"`
		Poster           null.String  `boil:"poster" json:"poster,omitempty"`
		Metascore        null.String  `boil:"metascore" json:"metascore,omitempty"`
		Plot             null.String  `boil:"plot" json:"plot,omitempty"`
		Director         null.String  `boil:"director" json:"director,omitempty"`
		Writer           null.String  `boil:"writer" json:"writer,omitempty"`
		Actors           null.String  `boil:"actors" json:"actors,omitempty"`
		Released         null.String  `boil:"released" json:"released,omitempty"`
		ReleasedUnix     null.Int64   `boil:"released_unix" json:"released_unix,omitempty"`
		Trailer          null.String  `boil:"trailer" json:"trailer,omitempty"`
		Type             null.String  `boil:"type" json:"type,omitempty"`
		Name             null.String  `boil:"name" json:"name,omitempty"`
		Network          null.String  `boil:"network" json:"network,omitempty"`
		Tagline          null.String  `boil:"tagline" json:"tagline,omitempty"`
		Backdrop         null.String  `boil:"backdrop" json:"backdrop,omitempty"`
		ProductionStatus null.String  `boil:"productionStatus" json:"productionStatus,omitempty"`
		AgeRating        null.String  `boil:"ageRating" json:"ageRating,omitempty"`
		EnrichState      null.String  `boil:"enrichState" json:"enrichState,omitempty"`
		EnrichedAt       null.Int64   `boil:"enrichedAt" json:"enrichedAt,omitempty"`
		IsWatched        null.Bool    `boil:"isWatched" json:"isWatched,omitempty"`
		Genres           null.String  `boil:"genres" json:"genres,omitempty"`
	}

	var result fullMeta
	err := models.NewQuery(
		qm.Select("md.*"),
		qm.Select("umd.isWatched as isWatched"),
		qm.Select("(SELECT group_concat(g.type, ',') FROM metaDataGenre mg INNER JOIN genre g ON g.id = mg.genreId WHERE mg.metaDataId = md.id) as genres"),
		qm.From("metaData as md"),
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = ?", req.UserId),
		qm.Where("md.id = ?", id),
	).BindG(context.Background(), &result)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get meta data: %s", err))
		return
	}
	transmitPromiseResponse(c, req, result)
}

func (s *Server) GetAllEpisodes(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	p := req.Data.(map[string]interface{})["metaDataId"]
	episodes, err := models.Episodes(
		qm.Where("metaDataId = ?", p),
		qm.Load(models.EpisodeRels.MetaDataIdMetaDatum),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes,
			qm.Where("userId = ?", req.UserId),
		),
		qm.Load(models.EpisodeRels.EpisodeIdMediaFiles),
		qm.Load(models.EpisodeRels.EpisodeIdTorrentFiles),
	).All(ctx, db.DB)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get episodes 2 %s", err))
		return
	}
	type Result struct {
		*models.Episode
		MetaData     *models.MetaDatum     `json:"metaData"`
		UserEpisode  *models.UserEpisode   `json:"userEpisode"`
		MediaFiles   []*models.MediaFile   `json:"mediaFiles"`
		TorrentFiles []TorrentWithPeers    `json:"torrentFiles"`
		IsWatched    bool                  `json:"isWatched"`
	}

	// one peer-count lookup (and at most one tracker scrape) for every
	// torrent of every episode
	var allTorrents []*models.TorrentFile
	for _, e := range episodes {
		allTorrents = append(allTorrents, e.R.EpisodeIdTorrentFiles...)
	}
	transmitWithPeerCounts(c, req, allTorrents, func(withPeers []TorrentWithPeers) interface{} {
		var result = []Result{}
		for _, e := range episodes {
			n := len(e.R.EpisodeIdTorrentFiles)
			episodeTorrents := withPeers[:n:n]
			withPeers = withPeers[n:]
			var userEpisode *models.UserEpisode
			if e.R.EpisodeIdUserEpisodes != nil && len(e.R.EpisodeIdUserEpisodes) > 0 {
				userEpisode = e.R.EpisodeIdUserEpisodes[0]
			}
			result = append(result, Result{
				e,
				e.R.MetaDataIdMetaDatum,
				userEpisode,
				e.R.EpisodeIdMediaFiles,
				episodeTorrents,
				userEpisode != nil && userEpisode.IsWatched.Bool,
			})
		}
		return result
	})
}

func (s *Server) GetMediaFilesByMetaId(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	p := req.Data.(map[string]interface{})["metaDataId"]
	mediaFiles, err := models.MediaFiles(
		qm.Where("metaDataId = ?", p),
	).All(ctx, db.DB)
	torrentFiles, err := models.TorrentFiles(
		qm.Where("metaDataId = ?", p),
	).All(ctx, db.DB)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get media / torrent files %s", err))
		return
	}
	type Result struct {
		MediaFiles   []*models.MediaFile `json:"mediaFiles,omitempty"`
		TorrentFiles []TorrentWithPeers  `json:"torrentFiles,omitempty"`
	}
	transmitWithPeerCounts(c, req, torrentFiles, func(withPeers []TorrentWithPeers) interface{} {
		return Result{mediaFiles, withPeers}
	})
}

func (s *Server) OpenExternal(c *websocket.Conn, req PayloadRequest) {
	path := req.Data.(map[string]interface{})["url"]
	log.Println("Opening external:", path)
	err := open.Run(path.(string))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not open external %s", err))
		return
	}
	transmitPromiseResponse(c, req, "Opening external")
}

func (s *Server) OpenInMPV(c *websocket.Conn, req PayloadRequest) {
	data := req.Data.(map[string]interface{})
	url := data["url"].(string)

	// --ontop ensures mpv comes to the foreground when launched from a
	// background process (Windows blocks focus-stealing otherwise). User can
	// toggle it off in-player with the T key.
	args := []string{"--ontop"}
	// Optional: caller can pass an id (e.g. metaDataId) to tag progress pings.
	roosterID := ""
	if rawID, ok := data["id"]; ok && rawID != nil {
		roosterID = fmt.Sprintf("%v", rawID)
		if roosterID != "" {
			args = append(args, "--script-opts=rooster-id="+roosterID)
		}
	}

	// Resume from last known position if we have a non-finished progress row
	// for this id and there's a meaningful offset to seek to.
	if roosterID != "" && db.DB != nil {
		if wp, err := db.GetWatchProgress(db.DB, roosterID); err == nil && wp != nil {
			if !wp.Finished && wp.TimePos >= 30 {
				args = append(args, fmt.Sprintf("--start=%.0f", wp.TimePos))
				log.Printf("Resuming MPV id=%s at %.0fs (%.1f%%)", roosterID, wp.TimePos, wp.Percent)
			}
		} else if err != nil {
			log.Println("watchProgress lookup error:", err)
		}
	}

	args = append(args, url)

	log.Println("Opening in MPV:", url, "args:", args)
	cmd := exec.Command("mpv", args...)
	// Allow mpv to take foreground focus on Windows (no-op elsewhere).
	allowChildForeground()
	err := cmd.Start()
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not open mpv: %s", err))
		return
	}
	transmitPromiseResponse(c, req, "Opening in MPV")
}

func (s *Server) SetWatched(c *websocket.Conn, req PayloadRequest) {
	typeWatched := req.Data.(map[string]interface{})["type"].(string)
	entityId := (req.Data.(map[string]interface{})["entityId"]).(float64)
	isWatched := req.Data.(map[string]interface{})["isWatched"].(bool)
	if typeWatched == "Episode" {
		s.setWatchedEpisode(c, req, int64(entityId), isWatched)
	} else {
		s.setWatchedMeta(c, req, int64(entityId), isWatched)
	}
}

func (s *Server) GetMetaDataByFileId(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	id := int64(req.Data.(map[string]interface{})["id"].(float64))
	mediaFile, err := models.MediaFiles(
		qm.Where("id = ?", id),
	).One(ctx, db.DB)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find media file by id in db %s", err))
		return
	}

	type meta struct {
		Id           null.Int64  `boil:"id" json:"id,omitempty" toml:"id" yaml:"id,omitempty"`
		Title        null.String `boil:"title" json:"title,omitempty" toml:"title" yaml:"title,omitempty"`
		ImdbId       null.String `boil:"imdbId" json:"imdbId,omitempty" toml:"imdbId" yaml:"imdbId,omitempty"`
		TmdbId       null.Int64  `boil:"tmdbId" json:"tmdbId,omitempty" toml:"tmdbId" yaml:"tmdbId,omitempty"`
		Episode      null.Int64  `boil:"episode" json:"episode,omitempty" toml:"episode" yaml:"episode,omitempty"`
		Season       null.Int64  `boil:"season" json:"season,omitempty" toml:"season" yaml:"season,omitempty"`
		IsWatched    null.Bool   `boil:"isWatched" json:"isWatched,omitempty" toml:"isWatched" yaml:"isWatched,omitempty"`
		Poster       null.String `boil:"poster" json:"poster,omitempty" toml:"poster" yaml:"poster,omitempty"`
		Plot         null.String `boil:"plot" json:"plot,omitempty" toml:"plot" yaml:"plot,omitempty"`
		EpisodePlot  null.String `boil:"episodePlot" json:"episodePlot,omitempty" toml:"episodePlot" yaml:"episodePlot,omitempty"`
		EpisodeTitle null.String `boil:"episodeTitle" json:"episodeTitle,omitempty" toml:"episodeTitle" yaml:"episodeTitle,omitempty"`
	}
	var tmp meta
	err = models.NewQuery(
		qm.Select("md.*, umd.isWatched as isWatched"),
		qm.From("metaData as md"),
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = ?", req.UserId),
		qm.Where("id = ?", mediaFile.MetaDataId.Int64)).BindG(context.Background(), &tmp)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find meta data in db %s", err))
		return
	}
	if mediaFile.EpisodeId.Valid {
		err = models.NewQuery(
			qm.Select(`ep.*, 
ep.plot as episodePlot, 
ep.title as episodeTitle, 
md.*, ue.isWatched as isWatched`),
			qm.From("episode as ep"),
			qm.Where("ep.id = ?", mediaFile.EpisodeId.Int64),
			qm.LeftOuterJoin("userEpisode as ue on ue.episodeId = ep.id and ue.userId = ?", req.UserId),
			qm.LeftOuterJoin("metaData as md on md.id = ep.metaDataId"),
		).BindG(context.Background(), &tmp)
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not find episode in db %s", err))
			return
		}
		tmp.Id = null.Int64From(mediaFile.EpisodeId.Int64)
		//tmp["userEpisode"] = episode
		//tmp["isAlreadyWatched"] = episode.isWatched.Bool
		//tmp["isAlreadyWatched"] = episode.(*models.Episode).R.EpisodeIdUserEpisodes[0].IsWatched.Bool
	}
	transmitPromiseResponse(c, req, tmp)
}

func (s *Server) GetAllGenres(c *websocket.Conn, req PayloadRequest) {
	// Query with counts from junction table
	type GenreWithCount struct {
		ID    int64  `boil:"id" json:"id"`
		Type  string `boil:"type" json:"type"`
		Count int64  `boil:"count" json:"count"`
	}

	var genres []GenreWithCount
	err := queries.Raw(`
		SELECT g.id, g.type, COUNT(mg.metaDataId) as count
		FROM genre g
		LEFT JOIN metaDataGenre mg ON g.id = mg.genreId
		GROUP BY g.id, g.type
		HAVING count > 0
		ORDER BY count DESC, g.type ASC
	`).Bind(context.Background(), db.DB, &genres)

	if err != nil {
		log.Printf("Error fetching genres: %v", err)
		transmitPromiseReject(c, req, fmt.Sprintf("could not get genres %s", err))
		return
	}

	log.Printf("✓ Returning %d genres", len(genres))
	transmitPromiseResponse(c, req, genres)
}

func (s *Server) ReprocessGenresRequest(c *websocket.Conn, req PayloadRequest) {

	s.BroadcastMessage("Processing genres...")

	count, err := s.ReprocessGenres()
	if err != nil {
		transmitPromiseReject(c, req, err)
	}

	s.BroadcastMessage(fmt.Sprintf("Processed %d genres", count))
	transmitPromiseResponse(c, req, fmt.Sprintf("Processed %d genres", count))
}

func (s *Server) ReprocessGenres() (int, error) {
	// This function is now a no-op with many-to-many architecture
	// Genres are created incrementally when metadata is added
	// Just return the count of existing genres
	ctx := context.Background()
	count, err := models.Genres().Count(ctx, db.DB)
	if err != nil {
		return 0, fmt.Errorf("could not count genres: %w", err)
	}

	log.Printf("Genre count: %d (using many-to-many architecture, no reprocessing needed)", count)
	return int(count), nil
}

func (s *Server) setWatchedEpisode(c *websocket.Conn, req PayloadRequest, entityId int64, isWatched bool) {

	type response struct {
		IsSeriesWatched bool `json:"isSeriesWatched"`
	}

	ctx := context.Background()
	episode, err := models.FindEpisode(ctx, db.DB, null.Int64From(entityId))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find episode %s", err))
		return
	}

	// Check if userEpisode already exists
	uep, err := models.UserEpisodes(
		qm.Where("episodeId = ?", entityId),
		qm.Where("userId = ?", req.UserId),
	).One(ctx, db.DB)
	if err == nil {
		// update existing
		uep.IsWatched = null.BoolFrom(isWatched)
		_, err = uep.Update(ctx, db.DB, boil.Infer())
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not update user episode %s", err))
			return
		}
	} else {
		// create new
		err = episode.AddEpisodeIdUserEpisodes(ctx, db.DB, true, &models.UserEpisode{
			UserId:    null.Int64From(1),
			IsWatched: null.BoolFrom(isWatched),
		})
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not create user episode data %s", err))
			return
		}
	}

	// check if all episodes are watched
	eps, err := models.Episodes(
		qm.Where("metaDataId = ?", episode.MetaDataId.Int64),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes,
			qm.Where("userId = ?", req.UserId),
		),
	).All(ctx, db.DB)

	isSeriesWatched := false
	if err == nil {
		isSeriesWatched = true
		for _, e := range eps {
			if e.R.EpisodeIdUserEpisodes == nil || len(e.R.EpisodeIdUserEpisodes) == 0 || !e.R.EpisodeIdUserEpisodes[0].IsWatched.Bool {
				isSeriesWatched = false
				break
			}
		}
	}

	// update series watched status
	umd, err := models.UserMetaData(
		qm.Where("metaDataId = ?", episode.MetaDataId.Int64),
		qm.Where("userId = ?", req.UserId),
	).One(ctx, db.DB)
	if err == nil {
		umd.IsWatched = null.BoolFrom(isSeriesWatched)
		_, _ = umd.Update(ctx, db.DB, boil.Infer())
	} else {
		newUmd := &models.UserMetaDatum{
			UserId:     null.Int64From(1),
			MetaDataId: episode.MetaDataId,
			IsWatched:  null.BoolFrom(isSeriesWatched),
		}
		_ = newUmd.Insert(ctx, db.DB, boil.Infer())
	}

	res := response{
		IsSeriesWatched: isSeriesWatched,
	}
	transmitPromiseResponse(c, req, res)
}

func (s *Server) setWatchedMeta(c *websocket.Conn, req PayloadRequest, entityId int64, isWatched bool) {
	ctx := context.Background()
	meta, err := models.FindMetaDatum(ctx, db.DB, null.Int64From(entityId))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find meta %s", err))
		return
	}

	// Check if userMetaDatum already exists
	umd, err := models.UserMetaData(
		qm.Where("metaDataId = ?", entityId),
		qm.Where("userId = ?", req.UserId),
	).One(ctx, db.DB)
	if err == nil {
		// update existing
		umd.IsWatched = null.BoolFrom(isWatched)
		_, err = umd.Update(ctx, db.DB, boil.Infer())
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not update user meta %s", err))
			return
		}
		transmitPromiseResponse(c, req, "Meta updated")
		return
	}

	// create new
	err = meta.AddMetaDataIdUserMetaData(ctx, db.DB, true, &models.UserMetaDatum{
		UserId:    null.Int64From(1),
		IsWatched: null.BoolFrom(isWatched),
	})
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not create user meta data %s", err))
		return
	}
	transmitPromiseResponse(c, req, "Meta updated")
}

func (s *Server) RouteNotFound(c *websocket.Conn, data PayloadRequest) {
	transmitPromiseReject(c, data, "Route not found")
}

// EnrichMetadataFn is wired up by main.go to gtmdb.EnrichOne to avoid
// circular imports between the server and tmdb packages.
var EnrichMetadataFn func(metaDataId int64, force bool) (*models.MetaDatum, error)

func (s *Server) EnrichMetaData(c *websocket.Conn, req PayloadRequest) {
	if EnrichMetadataFn == nil {
		transmitPromiseReject(c, req, "enrichment not initialized")
		return
	}

	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}

	idF, ok := payload["metaDataId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "metaDataId required")
		return
	}
	force := false
	if v, ok := payload["force"].(bool); ok {
		force = v
	}

	md, err := EnrichMetadataFn(int64(idF), force)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("enrichment failed: %v", err))
		return
	}

	transmitPromiseResponse(c, req, md)
}

func (s *Server) GetTrailer(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	title := req.Data.(map[string]interface{})["title"].(string)
	year := int(req.Data.(map[string]interface{})["year"].(float64))
	metaDataId := int64(req.Data.(map[string]interface{})["metaDataId"].(float64))
	trailer, err := GetYouTubeTrailer(title, year)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get trailer %s", err))
		return
	}

	// update trailer in db
	meta, err := models.FindMetaDatum(ctx, db.DB, null.Int64From(metaDataId))
	if err == nil {
		meta.Trailer = null.StringFrom(trailer)
		_, _ = meta.Update(ctx, db.DB, boil.Infer())
	}
	transmitPromiseResponse(c, req, trailer)
}

func (s *Server) GetImdbRating(c *websocket.Conn, req PayloadRequest) {
	ctx := context.Background()
	imdbId := req.Data.(map[string]interface{})["imdbId"].(string)
	metaDataId := int64(req.Data.(map[string]interface{})["metaDataId"].(float64))

	// Try IMDB first, then fall back to TMDB
	rating, err := GetImdbRatingsFromImdb(imdbId)
	if err != nil || rating.Score < 0 {
		log.Printf("IMDB scraping failed for %s, trying TMDB fallback", imdbId)
		rating, err = GetRatingsFromTMDB(imdbId)
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not get rating from IMDB or TMDB: %s", err))
			return
		}
		log.Printf("Got rating from TMDB for %s: %.1f", imdbId, rating.Score)
	}

	// update rating in db
	meta, err := models.FindMetaDatum(ctx, db.DB, null.Int64From(metaDataId))
	if err == nil {
		meta.Votes = null.Int64From(rating.Votes)
		meta.Rating = null.Float64From(rating.Score)
		_, _ = meta.Update(ctx, db.DB, boil.Infer())
	}

	transmitPromiseResponse(c, req, rating)
}

type Channel struct {
	Name     string `json:"name"`
	Uri      string `json:"uri"`
	Category string `json:"category"`
	Logo     string `json:"logo"`
	Tags     []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"tags"`
}
type Channels struct {
	Channels []Channel `json:"channels"`
}

type XtreamStream struct {
	Num          int         `json:"num"`
	Name         string      `json:"name"`
	StreamType   string      `json:"stream_type"`
	StreamID     int         `json:"stream_id"`
	StreamIcon   string      `json:"stream_icon"`
	CategoryID   string      `json:"category_id"`
	EPGChannelID string      `json:"epg_channel_id"`
	CustomSid    interface{} `json:"custom_sid"`
	Added        string      `json:"added"`
	IsAdult      int         `json:"is_adult"`
	CategoryIDs  []int       `json:"category_ids"`
	DirectSource string      `json:"direct_source"`
	TVArchive    int         `json:"tv_archive"`
	TVArchiveDur interface{} `json:"tv_archive_duration"`
	ContainerExt string      `json:"container_extension"`
}

func (s *Server) GetChannels(c *websocket.Conn, req PayloadRequest) {

	// prefer live_streams.json (Xtream) over m3u_filtered.json
	if _, err := os.Stat("live_streams.json"); err == nil {
		s.getChannelsFromXtream(c, req)
		return
	}

	// fallback to m3u_filtered.json
	if _, err := os.Stat("m3u_filtered.json"); os.IsNotExist(err) {
		if _, err := os.Stat("streams.m3u"); os.IsNotExist(err) {
			transmitPromiseReject(c, req, fmt.Sprintf("could not get channels %s", err))
			return
		}

		playlist, err := m3u.Parse("streams.m3u")
		if err == nil && len(playlist.Tracks) > 0 {

			var channels Channels
			var tmpChannels []Channel
			for _, track := range playlist.Tracks {
				if track.URI == "" ||
					strings.Contains(track.URI, "series") ||
					strings.Contains(track.URI, "movie") {
					continue
				}
				channel := Channel{
					Name:     track.Name,
					Uri:      track.URI,
					Category: "Live TV",
					Logo:     "",
				}
				for _, tag := range track.Tags {
					if tag.Name == "tvg-name" {
						channel.Name = tag.Value
					} else if tag.Name == "tvg-logo" {
						channel.Logo = tag.Value
					} else if tag.Name == "group-title" {
						channel.Category = tag.Value
					} else {
						channel.Tags = append(channel.Tags, struct {
							Key   string `json:"key"`
							Value string `json:"value"`
						}{
							Key:   tag.Name,
							Value: tag.Value,
						})
					}
				}
				tmpChannels = append(tmpChannels, channel)
			}
			channels.Channels = tmpChannels

			// create json file from the playlist
			file, err := os.Create("m3u_filtered.json")
			if err != nil {
				transmitPromiseReject(c, req, fmt.Sprintf("could not create file %s", err))
				return
			}
			defer file.Close()
			encoder := json.NewEncoder(file)
			//encoder.SetIndent("", "  ")
			err = encoder.Encode(channels)
			if err != nil {
				transmitPromiseReject(c, req, fmt.Sprintf("could not encode file %s", err))
				return
			}
			fmt.Println("File created successfully")
		}
	}

	// check if the file exists
	if _, err := os.Stat("m3u_filtered.json"); os.IsNotExist(err) {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get channels %s", err))
		return
	}

	// read the m3u_filtered.json file form the disk
	file, err := os.ReadFile("m3u_filtered.json")
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get channels %s", err))
		return
	}

	transmitPromiseResponse(c, req, string(file))
}

func (s *Server) getChannelsFromXtream(c *websocket.Conn, req PayloadRequest) {
	file, err := os.ReadFile("live_streams.json")
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not read live_streams.json: %s", err))
		return
	}

	var streams []XtreamStream
	if err := json.Unmarshal(file, &streams); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not parse live_streams.json: %s", err))
		return
	}

	var channels Channels
	for _, stream := range streams {
		proxyUri := fmt.Sprintf("/stream/live/%s/%s/%d.m3u8", xtreamUsername, xtreamPassword, stream.StreamID)
		directUri := fmt.Sprintf("%s/live/%s/%s/%d.m3u8", xtreamServer, xtreamUsername, xtreamPassword, stream.StreamID)
		channels.Channels = append(channels.Channels, Channel{
			Name:     stream.Name,
			Uri:      proxyUri,
			Category: stream.CategoryID,
			Logo:     stream.StreamIcon,
			Tags: []struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}{
				{Key: "directUrl", Value: directUri},
			},
		})
	}

	result, err := json.Marshal(channels)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not marshal channels: %s", err))
		return
	}

	transmitPromiseResponse(c, req, string(result))
}

type FetchIconRequest struct {
	ChannelName string `json:"channelName"`
	CleanName   string `json:"cleanName"`
	LogoUrl     string `json:"logoUrl"`
}

// HTTP client with timeout for icon fetching
var iconHttpClient = &http.Client{
	Timeout: 10 * time.Second,
}

func (s *Server) FetchChannelIcon(c *websocket.Conn, req PayloadRequest) {
	dataBytes, _ := json.Marshal(req.Data)
	var iconReq FetchIconRequest
	if err := json.Unmarshal(dataBytes, &iconReq); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("invalid request: %s", err))
		return
	}

	if iconReq.CleanName == "" {
		transmitPromiseReject(c, req, "cleanName is required")
		return
	}

	// Create icons directory if it doesn't exist
	iconsDir := "icons"
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not create icons dir: %s", err))
		return
	}

	// Sanitize filename
	safeFileName := sanitizeFileName(iconReq.CleanName)
	iconPath := filepath.Join(iconsDir, safeFileName+".png")

	// Check if icon already exists
	if _, err := os.Stat(iconPath); err == nil {
		transmitPromiseResponse(c, req, "/icons/"+safeFileName+".png")
		return
	}

	// The M3U logo URL is the only icon source; Clearbit's logo API was shut
	// down and Google Images no longer returns results to plain HTTP clients.
	if iconReq.LogoUrl == "" {
		transmitPromiseReject(c, req, "could not find icon")
		return
	}
	imageData, err := fetchValidImage(iconReq.LogoUrl)
	if err != nil {
		log.Printf("M3U logo failed for %s: %v", iconReq.CleanName, err)
		transmitPromiseReject(c, req, "could not find icon")
		return
	}

	err = os.WriteFile(iconPath, imageData, 0644)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not save icon: %s", err))
		return
	}

	log.Printf("Icon saved: %s (%d bytes)", iconPath, len(imageData))
	transmitPromiseResponse(c, req, "/icons/"+safeFileName+".png")
}

func sanitizeFileName(name string) string {
	// Remove or replace invalid filename characters
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	result := name
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, "_")
	}
	return strings.TrimSpace(result)
}

// fetchValidImage downloads an image and validates it's actually an image
func fetchValidImage(url string) ([]byte, error) {
	resp, err := iconHttpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	// Check content type
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("not an image: %s", contentType)
	}

	// Read body
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read failed: %w", err)
	}

	// Validate minimum size (a valid image should be at least a few hundred bytes)
	if len(data) < 100 {
		return nil, fmt.Errorf("image too small: %d bytes", len(data))
	}

	// Check for image magic bytes (PNG, JPEG, GIF, WebP)
	if !isValidImageData(data) {
		return nil, fmt.Errorf("invalid image data")
	}

	return data, nil
}

// isValidImageData checks magic bytes for common image formats
func isValidImageData(data []byte) bool {
	if len(data) < 8 {
		return false
	}
	// PNG: 89 50 4E 47
	if data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return true
	}
	// JPEG: FF D8 FF
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return true
	}
	// GIF: 47 49 46 38
	if data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return true
	}
	// WebP: 52 49 46 46 ... 57 45 42 50
	if data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 {
		if len(data) >= 12 && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
			return true
		}
	}
	// BMP: 42 4D
	if data[0] == 0x42 && data[1] == 0x4D {
		return true
	}
	// ICO: 00 00 01 00
	if data[0] == 0x00 && data[1] == 0x00 && data[2] == 0x01 && data[3] == 0x00 {
		return true
	}
	return false
}
