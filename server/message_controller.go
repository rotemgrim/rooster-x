package server

import (
	"context"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/skratchdot/open-golang/open"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/models"
	"log"
	"strings"
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
	Velocity       null.Int     `boil:"velocity" json:"velocity,omitempty"`
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
	var users models.UserSlice
	users = models.Users().AllGP(context.Background())
	transmitPromiseResponse(c, data, users)
}

func (s *Server) SaveConfig(c *websocket.Conn, request PayloadRequest) {
	// do nothing for now
	transmitPromiseResponse(c, request, "Config saved")
}

func (s *Server) GetAllMedia(c *websocket.Conn, req PayloadRequest) {
	filter := req.Data.(map[string]interface{})["filter"]
	isTorrents := req.Data.(map[string]interface{})["isTorrents"]
	s.GetMedia(c, req, isTorrents.(bool), filter.(string))
}

func (s *Server) GetMedia(c *websocket.Conn, data PayloadRequest, isTorrents bool, filter string) {
	var media []MediaDataExtended
	var userId int = data.UserId
	queryMods := []qm.QueryMod{
		qm.Select("md.*, umd.isWatched as isWatched, " +
			"max(IFNULL(CAST(SUBSTR(sub.resolution, 0) AS int), 0)) as resolution, " +
			"rtrim(replace(group_concat(DISTINCT sub.quality||','), ',,', ','), ',') as quality"),
		qm.From("metaData as md"),
		//qm.Where("sub.metaDataId != 0"),
		//qm.LeftOuterJoin("metaData as md on md.id = sub.metaDataId"),
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = ?", userId),
		qm.GroupBy("md.id"),
	}

	if isTorrents {
		//queryMods = append(queryMods, qm.From("torrentFile as sub"))
		queryMods = append(queryMods, qm.LeftOuterJoin("torrentFile as sub on sub.metaDataId = md.id"))
		queryMods = append(queryMods, qm.Select("max(sub.uploadedAt) as uploadedAt, "+
			"DATE(SUBSTR(uploadedAt, 1, 19)) as uploadedDate,"+
			"count(sub.id) as mediaFiles,"+
			""))
		queryMods = append(queryMods, qm.Where("sub.episodeId = (select id from episode where metaDataId = md."+
			"id order by season desc, episode desc limit 1) or sub.episodeId is null"))
		queryMods = append(queryMods, qm.Where("sub.magnet is not null"))
		queryMods = append(queryMods, qm.OrderBy(" max(sub.uploadedAt) DESC"))
	} else {
		//queryMods = append(queryMods, qm.From("mediaFile as sub"))
		queryMods = append(queryMods, qm.LeftOuterJoin("mediaFile as sub on sub.metaDataId = md.id"))
		queryMods = append(queryMods, qm.Select("max(sub.downloadedAt) as downloadedAt, "+
			"DATE(SUBSTR(downloadedAt, 1, 19)) as downloadedDate,"+
			"count(sub.id) as mediaFiles"))
		queryMods = append(queryMods, qm.OrderBy(" max(sub.downloadedAt) DESC"))
	}

	if filter == "movies" {
		queryMods = append(queryMods, qm.Where("md.series = false"))
	} else if filter == "series" {
		queryMods = append(queryMods, qm.Where("md.series = true"))
	}

	err := models.NewQuery(queryMods...).BindG(context.Background(), &media)
	if err != nil {
		query := models.NewQuery(queryMods...)
		text, _ := queries.BuildQuery(query)
		transmitPromiseReject(c, data, fmt.Sprintf("could not get media:\n%s\n\nquery: %s", err, text))
		//transmitPromiseReject(c, data, fmt.Sprintf("could not get media %s", err))
		return
	}
	query := models.NewQuery(queryMods...)
	text, _ := queries.BuildQuery(query)
	log.Printf(text)
	transmitPromiseResponse(c, data, media)
}

func (s *Server) GetAllTorrents(c *websocket.Conn, data PayloadRequest) {
	s.GetMedia(c, data, true, "all")
}

func (s *Server) GetAllEpisodes(c *websocket.Conn, req PayloadRequest) {
	p := req.Data.(map[string]interface{})["metaDataId"]
	episodes, err := models.Episodes(
		qm.Where("metaDataId = ?", p),
		qm.Load(models.EpisodeRels.MetaDataIdMetaDatum),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes,
			qm.Where("userId = ?", req.UserId),
		),
		qm.Load(models.EpisodeRels.EpisodeIdMediaFiles),
		qm.Load(models.EpisodeRels.EpisodeIdTorrentFiles),
	).AllG(context.Background())
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
	p := req.Data.(map[string]interface{})["metaDataId"]
	mediaFiles, err := models.MediaFiles(
		qm.Where("metaDataId = ?", p),
	).AllG(context.Background())
	torrentFiles, err := models.TorrentFiles(
		qm.Where("metaDataId = ?", p),
	).AllG(context.Background())
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
	id := int64(req.Data.(map[string]interface{})["id"].(float64))
	mediaFile, err := models.MediaFiles(
		qm.Where("id = ?", id),
	).OneG(context.Background())
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
	genres, err := models.Genres(qm.OrderBy("type ASC")).AllG(context.Background())
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get genres %s", err))
		return
	}
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

	// remove all genres
	_, err := models.Genres().DeleteAllG(context.Background())
	if err != nil {
		return 0, fmt.Errorf("could not delete genres %s", err)
	}

	// get all metadata
	metas, err := models.MetaData().AllG(context.Background())
	if err != nil {
		return 0, fmt.Errorf("could not get metadata %s", err)
	}

	// for each metadata get genres split them and add them to the genre table
	count := 0
	var genres []*models.Genre

	for _, meta := range metas {
		if meta.Genres.Valid {
			genresArr := strings.Split(meta.Genres.String, ",")
			for _, genre := range genresArr {
				// trim spaces and change to lowercase
				genre = strings.TrimSpace(genre)
				if genre == "" {
					continue
				}
				genre = strings.ToLower(genre)
				found := false
				for _, g := range genres {
					if g.Type.String == genre {
						g.Count.Int64 += 1
						_, err = g.UpdateG(context.Background(), boil.Infer())
						found = true
						break
					}
				}
				if !found {
					genreModel := models.Genre{
						Type:  null.StringFrom(genre),
						Count: null.Int64From(1),
					}
					err = genreModel.InsertG(context.Background(), boil.Infer())
					if err == nil {
						genres = append(genres, &genreModel)
						count++
					}
				}
			}
		}
	}
	return count, nil
}

func (s *Server) setWatchedEpisode(c *websocket.Conn, req PayloadRequest, entityId int64, isWatched bool) {

	type response struct {
		IsSeriesWatched bool `json:"isSeriesWatched"`
	}

	episode, err := models.FindEpisodeG(context.Background(), null.Int64From(entityId))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find episode %s", err))
		return
	}

	// Check if userEpisode already exists
	uep, err := models.UserEpisodes(
		qm.Where("episodeId = ?", entityId),
		qm.Where("userId = ?", req.UserId),
	).OneG(context.Background())
	if err == nil {
		// update existing
		uep.IsWatched = null.BoolFrom(isWatched)
		_, err = uep.UpdateG(context.Background(), boil.Infer())
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not update user episode %s", err))
			return
		}
	} else {
		// create new
		err = episode.AddEpisodeIdUserEpisodesG(context.Background(), true, &models.UserEpisode{
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
	).AllG(context.Background())

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
	).OneG(context.Background())
	if err == nil {
		umd.IsWatched = null.BoolFrom(isSeriesWatched)
		_, _ = umd.UpdateG(context.Background(), boil.Infer())
	} else {
		newUmd := &models.UserMetaDatum{
			UserId:     null.Int64From(1),
			MetaDataId: episode.MetaDataId,
			IsWatched:  null.BoolFrom(isSeriesWatched),
		}
		_ = newUmd.InsertG(context.Background(), boil.Infer())
	}

	res := response{
		IsSeriesWatched: isSeriesWatched,
	}
	transmitPromiseResponse(c, req, res)
}

func (s *Server) setWatchedMeta(c *websocket.Conn, req PayloadRequest, entityId int64, isWatched bool) {
	meta, err := models.FindMetaDatumG(context.Background(), null.Int64From(entityId))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find meta %s", err))
		return
	}

	// Check if userMetaDatum already exists
	umd, err := models.UserMetaData(
		qm.Where("metaDataId = ?", entityId),
		qm.Where("userId = ?", req.UserId),
	).OneG(context.Background())
	if err == nil {
		// update existing
		umd.IsWatched = null.BoolFrom(isWatched)
		_, err = umd.UpdateG(context.Background(), boil.Infer())
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not update user meta %s", err))
			return
		}
		transmitPromiseResponse(c, req, "Meta updated")
		return
	}

	// create new
	err = meta.AddMetaDataIdUserMetaDataG(context.Background(), true, &models.UserMetaDatum{
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
	title := req.Data.(map[string]interface{})["title"].(string)
	year := int(req.Data.(map[string]interface{})["year"].(float64))
	metaDataId := int64(req.Data.(map[string]interface{})["metaDataId"].(float64))
	trailer, err := GetYouTubeTrailer(title, year)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get trailer %s", err))
		return
	}

	// update trailer in db
	meta, err := models.FindMetaDatumG(context.Background(), null.Int64From(metaDataId))
	if err == nil {
		meta.Trailer = null.StringFrom(trailer)
		_, _ = meta.UpdateG(context.Background(), boil.Infer())
	}
	transmitPromiseResponse(c, req, trailer)
}

func (s *Server) GetImdbRating(c *websocket.Conn, req PayloadRequest) {
	imdbId := req.Data.(map[string]interface{})["imdbId"].(string)
	metaDataId := int64(req.Data.(map[string]interface{})["metaDataId"].(float64))

	rating, err := GetImdbRatingsFromImdb(imdbId)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get imdb rating %s", err))
		return
	}

	// update rating in db
	meta, err := models.FindMetaDatumG(context.Background(), null.Int64From(metaDataId))
	if err == nil {
		meta.Votes = null.Int64From(rating.Votes)
		meta.Rating = null.Float64From(rating.Score)
		_, _ = meta.UpdateG(context.Background(), boil.Infer())
	}

	transmitPromiseResponse(c, req, rating)
}
