package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type StatusResponse string // "success" or "failure"
const (
	StatusMsg     StatusResponse = "msg"
	StatusSuccess StatusResponse = "success"
	StatusFailure StatusResponse = "failure"
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

type MediaDataExtended struct {
	//models.MetaDatum
	ID             null.Int64   `boil:"id" json:"id,omitempty" toml:"id" yaml:"id,omitempty"`
	Title          null.String  `boil:"title" json:"title,omitempty" toml:"title" yaml:"title,omitempty"`
	ImdbId         null.String  `boil:"imdbId" json:"imdbId,omitempty" toml:"imdbId" yaml:"imdbId,omitempty"`
	TMDBID         null.Int64   `boil:"tmdbId" json:"tmdbId,omitempty" toml:"tmdbId" yaml:"tmdbId,omitempty"`
	Genres         null.String  `boil:"genres" json:"genres,omitempty" toml:"genres" yaml:"genres,omitempty"`
	Languages      null.String  `boil:"languages" json:"languages,omitempty" toml:"languages" yaml:"languages,omitempty"`
	Country        null.String  `boil:"country" json:"country,omitempty" toml:"country" yaml:"country,omitempty"`
	Votes          null.Int64   `boil:"votes" json:"votes,omitempty" toml:"votes" yaml:"votes,omitempty"`
	Series         null.Bool    `boil:"series" json:"series,omitempty" toml:"series" yaml:"series,omitempty"`
	Rating         null.Float64 `boil:"rating" json:"rating,omitempty" toml:"rating" yaml:"rating,omitempty"`
	Runtime        null.Int64   `boil:"runtime" json:"runtime,omitempty" toml:"runtime" yaml:"runtime,omitempty"`
	Year           null.Int64   `boil:"year" json:"year,omitempty" toml:"year" yaml:"year,omitempty"`
	Poster         null.String  `boil:"poster" json:"poster,omitempty" toml:"poster" yaml:"poster,omitempty"`
	Metascore      null.String  `boil:"metascore" json:"metascore,omitempty" toml:"metascore" yaml:"metascore,omitempty"`
	Plot           null.String  `boil:"plot" json:"plot,omitempty" toml:"plot" yaml:"plot,omitempty"`
	Director       null.String  `boil:"director" json:"director,omitempty" toml:"director" yaml:"director,omitempty"`
	Writer         null.String  `boil:"writer" json:"writer,omitempty" toml:"writer" yaml:"writer,omitempty"`
	Actors         null.String  `boil:"actors" json:"actors,omitempty" toml:"actors" yaml:"actors,omitempty"`
	Released       null.String  `boil:"released" json:"released,omitempty" toml:"released" yaml:"released,omitempty"`
	ReleasedUnix   null.Int64   `boil:"released_unix" json:"released_unix,omitempty" toml:"released_unix" yaml:"released_unix,omitempty"`
	Trailer        null.String  `boil:"trailer" json:"trailer,omitempty" toml:"trailer" yaml:"trailer,omitempty"`
	Type           null.String  `boil:"type" json:"type,omitempty" toml:"type" yaml:"type,omitempty"`
	Name           null.String  `boil:"name" json:"name,omitempty" toml:"name" yaml:"name,omitempty"`
	IsWatched      null.Bool    `boil:"isWatched" json:"isWatched,omitempty"`
	DownloadedAt   null.String  `boil:"downloadedAt" json:"downloadedAt,omitempty"`
	UploadedAt     null.String  `boil:"uploadedAt" json:"uploadedAt,omitempty"`
	MediaFiles     null.Int     `boil:"mediaFiles" json:"mediaFiles,omitempty"`
	Quality        null.String  `boil:"quality" json:"quality,omitempty"`
	Resolution     null.String  `boil:"resolution" json:"resolution,omitempty"`
	UploadedDate   null.String  `boil:"uploadedDate" json:"uploadedDate,omitempty"`
	DownloadedDate null.String  `boil:"downloadedDate" json:"downloadedDate,omitempty"`
	TrendingCount  null.Int     `boil:"trendingCount" json:"trendingCount,omitempty"`
}

func (s *Server) FullSweep(c *websocket.Conn, data PayloadRequest) {
	go func(s *Server) {
		s.walker.FullSweep()
	}(s)
}

func (s *Server) SyncTorrents(c *websocket.Conn, data PayloadRequest) {
	go func(s *Server) {
		s.torrentsFetcher.FullSweep()
	}(s)
}

func (s *Server) GetConfig(c *websocket.Conn, data PayloadRequest) {
	var result = map[string]interface{}{
		"serverUrl":        "http://localhost:8080",
		"keepWindowsAlive": false,
		"proxySettings":    false,
		"dbPath":           "string",
		"tmdbApiKey":       "string",
		"userId":           "1",
		"isAdmin":          true,
	}
	transmitPromiseResponse(c, data, result)
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

func (s *Server) SaveConfig(c *websocket.Conn, request PayloadRequest) {
	// do nothing for now
	transmitPromiseResponse(c, request, "Config saved")
}

func (s *Server) GetAllMedia(c *websocket.Conn, req PayloadRequest) {
	filter := req.Data.(map[string]interface{})["filter"]
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

	s.GetMedia(c, req, isTorrents.(bool), filter.(string), genreList)
}

func (s *Server) GetMedia(c *websocket.Conn, data PayloadRequest, isTorrents bool, filter string, genres []string) {
	var media []MediaDataExtended
	var userId int = data.UserId
	queryMods := []qm.QueryMod{
		qm.Select("md.id, md.title, md.imdbId, md.tmdbId, md.languages, md.country, md.votes, md.series, md.rating, md.runtime, md.year, md.poster, md.metascore, md.plot, md.director, md.writer, md.actors, md.released, md.released_unix, md.trailer, md.type, md.name"),
		qm.Select("umd.isWatched as isWatched"),
		qm.Select("max(IFNULL(CAST(SUBSTR(sub.resolution, 0) AS int), 0)) as resolution"),
		qm.Select("rtrim(replace(group_concat(DISTINCT sub.quality||','), ',,', ','), ',') as quality"),

		qm.Select("(SELECT COUNT(*) FROM torrentFile as tf WHERE tf.metaDataId = md.id AND tf.seenAt > strftime('%s', 'now', '-48 hours')) as trendingCount"),

		qm.Select("(SELECT group_concat(g.type, ',') FROM metaDataGenre mg INNER JOIN genre g ON g.id = mg.genreId WHERE mg.metaDataId = md.id) as genres"),

		qm.From("metaData as md"),
	}

	// CRITICAL: Add genre filter FIRST, before expensive JOINs
	if len(genres) > 0 {
		log.Printf("Filtering by %d genre(s): %v", len(genres), genres)

		placeholders := make([]string, len(genres))
		args := make([]interface{}, len(genres))
		for i, genre := range genres {
			placeholders[i] = "?"
			args[i] = strings.ToLower(strings.TrimSpace(genre))
		}

		// Add WHERE clause BEFORE JOINs to reduce dataset early
		whereClause := fmt.Sprintf(`EXISTS (
			SELECT 1 
			FROM metaDataGenre mg
			INNER JOIN genre g ON g.id = mg.genreId
			WHERE mg.metaDataId = md.id 
			AND LOWER(g.type) IN (%s)
		)`, strings.Join(placeholders, ","))

		queryMods = append(queryMods, qm.Where(whereClause, args...))
	}

	// Add filter for movies/series
	if filter == "movies" {
		queryMods = append(queryMods, qm.Where("md.series = false"))
	} else if filter == "series" {
		queryMods = append(queryMods, qm.Where("md.series = true"))
	}

	// NOW add the expensive JOINs after filtering
	queryMods = append(queryMods,
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = ?", userId),
		qm.GroupBy("md.id"),
		qm.OrderBy("trendingCount DESC"),
	)

	if isTorrents {
		//queryMods = append(queryMods, qm.From("torrentFile as sub"))
		queryMods = append(queryMods, qm.LeftOuterJoin("torrentFile as sub on sub.metaDataId = md.id"))
		queryMods = append(queryMods, qm.Select("DATETIME(max(sub.seenAt), 'unixepoch') as uploadedAt, "+
			"DATE(seenAt, 'unixepoch') as uploadedDate,"+
			"count(sub.id) as mediaFiles"))
		queryMods = append(queryMods, qm.OrderBy(" max(sub.uploadedAt) DESC"))
	} else {
		//queryMods = append(queryMods, qm.From("mediaFile as sub"))
		queryMods = append(queryMods, qm.LeftOuterJoin("mediaFile as sub on sub.metaDataId = md.id"))
		queryMods = append(queryMods, qm.LeftOuterJoin("torrentFile as tf on tf.metaDataId = md.id"))
		queryMods = append(queryMods, qm.Select("max(sub.downloadedAt) as downloadedAt, "+
			"DATE(SUBSTR(downloadedAt, 1, 19)) as downloadedDate,"+
			"DATE(tf.seenAt, 'unixepoch') as uploadedDate,"+
			"count(sub.id) as mediaFiles"))
		queryMods = append(queryMods, qm.OrderBy(" max(sub.downloadedAt) DESC"))
	}
	queryMods = append(queryMods, qm.OrderBy("md.id DESC"))

	query := models.NewQuery(queryMods...)

	// Create context with timeout to prevent hanging queries
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := query.Bind(ctx, db.DB, &media)
	if err != nil {
		text, _ := queries.BuildQuery(query)
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("⚠ Query timeout after 30s (filter: %s, torrents: %v, genres: %v)", filter, isTorrents, genres)
			transmitPromiseReject(c, data, "Query timed out - too complex. Try fewer filters or wait for database optimization.")
		} else {
			log.Printf("Query error: %v", err)
			transmitPromiseReject(c, data, fmt.Sprintf("could not get media:\n%s\n\nquery: %s", err, text))
		}
		return
	}

	log.Printf("✓ Returned %d results (filter: %s, torrents: %v, genres: %v)", len(media), filter, isTorrents, genres)
	transmitPromiseResponse(c, data, media)
}

func (s *Server) GetAllTorrents(c *websocket.Conn, data PayloadRequest) {
	s.GetMedia(c, data, true, "all", []string{})
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
		TorrentFiles []*models.TorrentFile `json:"torrentFiles"`
		IsWatched    bool                  `json:"isWatched"`
	}
	var result = []Result{}
	for _, e := range episodes {
		var userEpisode *models.UserEpisode
		if e.R.EpisodeIdUserEpisodes != nil && len(e.R.EpisodeIdUserEpisodes) > 0 {
			userEpisode = e.R.EpisodeIdUserEpisodes[0]
		}
		result = append(result, Result{
			e,
			e.R.MetaDataIdMetaDatum,
			userEpisode,
			e.R.EpisodeIdMediaFiles,
			e.R.EpisodeIdTorrentFiles,
			userEpisode != nil && userEpisode.IsWatched.Bool,
		})
	}
	transmitPromiseResponse(c, req, result)
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
		MediaFiles   []*models.MediaFile   `json:"mediaFiles,omitempty"`
		TorrentFiles []*models.TorrentFile `json:"torrentFiles,omitempty"`
	}
	var result = Result{
		mediaFiles,
		torrentFiles,
	}
	transmitPromiseResponse(c, req, result)
}

func (s *Server) OpenExternal(c *websocket.Conn, req PayloadRequest) {
	path := req.Data.(map[string]interface{})["url"]
	log.Println("Opening external:", path)
	err := open.Run(path.(string))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not open external %s", err))
	}
	transmitPromiseResponse(c, req, "Opening external")
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

	rating, err := GetImdbRatingsFromImdb(imdbId)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get imdb rating %s", err))
		return
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

func (s *Server) GetChannels(c *websocket.Conn, req PayloadRequest) {

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

	// Try to download icon from various sources
	var err error
	var imageData []byte

	// Priority 1: Use logo URL from M3U data if provided
	if iconReq.LogoUrl != "" {
		log.Printf("Trying M3U logo URL: %s", iconReq.LogoUrl)
		imageData, err = fetchValidImage(iconReq.LogoUrl)
		if err == nil && len(imageData) > 0 {
			goto saveIcon
		}
		log.Printf("M3U logo failed for %s: %v", iconReq.CleanName, err)
	}

	// Priority 2: Try Clearbit (works for some brands)
	imageData, err = fetchValidImage(fmt.Sprintf("https://logo.clearbit.com/%s.com", strings.ToLower(strings.ReplaceAll(safeFileName, " ", ""))))
	if err == nil && len(imageData) > 0 {
		goto saveIcon
	}

	// Priority 3: Try with "tv" suffix
	imageData, err = fetchValidImage(fmt.Sprintf("https://logo.clearbit.com/%stv.com", strings.ToLower(strings.ReplaceAll(safeFileName, " ", ""))))
	if err == nil && len(imageData) > 0 {
		goto saveIcon
	}

	// No icon found
	log.Printf("No icon found for %s", iconReq.CleanName)
	transmitPromiseReject(c, req, "could not find icon")
	return

saveIcon:
	// Save the icon
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
