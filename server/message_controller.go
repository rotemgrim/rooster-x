package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/davecgh/go-spew/spew"
	"github.com/gorilla/websocket"
	"github.com/skratchdot/open-golang/open"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/models"
	"log"
)

type StatusResponse string // "success" or "failure"
const (
	StatusSuccess StatusResponse = "success"
	StatusFailure StatusResponse = "failure"
)

type PayloadResponse struct {
	ReplyChannel string         `json:"replyChannel"`
	Status       StatusResponse `json:"status"`
	Data         interface{}    `json:"data"`
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
	transmitPromiseResponse(c, request, "Config saved")
}

func (s *Server) GetAllMedia(c *websocket.Conn, data PayloadRequest) {
	//type MediaFileAndMetaData struct {
	//	models.MediaFile `boil:",bind"`
	//	models.MetaDatum `boil:",bind"`
	//}
	//media, err := models.MediaFiles(qm.Load(models.MetaDatumRels.MetaDataIdMediaFiles)).AllG(context.Background())
	//var media []MediaFileAndMetaData
	//err := models.NewQuery(
	//	qm.Select("mf.*, md.*"),
	//	qm.From("mediaFile as mf"),
	//	qm.InnerJoin("metaData as md on mf.metaDataId = md.id"),
	//).BindG(context.Background(), &media)
	type MediaWithDownloadedAt struct {
		//models.MetaDatum
		ID           null.Int64   `boil:"id" json:"id,omitempty" toml:"id" yaml:"id,omitempty"`
		Title        null.String  `boil:"title" json:"title,omitempty" toml:"title" yaml:"title,omitempty"`
		ImdbId       null.String  `boil:"imdbId" json:"imdbId,omitempty" toml:"imdbId" yaml:"imdbId,omitempty"`
		TMDBID       null.Int64   `boil:"tmdbId" json:"tmdbId,omitempty" toml:"tmdbId" yaml:"tmdbId,omitempty"`
		Genres       null.String  `boil:"genres" json:"genres,omitempty" toml:"genres" yaml:"genres,omitempty"`
		Languages    null.String  `boil:"languages" json:"languages,omitempty" toml:"languages" yaml:"languages,omitempty"`
		Country      null.String  `boil:"country" json:"country,omitempty" toml:"country" yaml:"country,omitempty"`
		Votes        null.Int64   `boil:"votes" json:"votes,omitempty" toml:"votes" yaml:"votes,omitempty"`
		Series       null.Bool    `boil:"series" json:"series,omitempty" toml:"series" yaml:"series,omitempty"`
		Rating       null.Float64 `boil:"rating" json:"rating,omitempty" toml:"rating" yaml:"rating,omitempty"`
		Runtime      null.Int64   `boil:"runtime" json:"runtime,omitempty" toml:"runtime" yaml:"runtime,omitempty"`
		Year         null.Int64   `boil:"year" json:"year,omitempty" toml:"year" yaml:"year,omitempty"`
		Poster       null.String  `boil:"poster" json:"poster,omitempty" toml:"poster" yaml:"poster,omitempty"`
		Metascore    null.String  `boil:"metascore" json:"metascore,omitempty" toml:"metascore" yaml:"metascore,omitempty"`
		Plot         null.String  `boil:"plot" json:"plot,omitempty" toml:"plot" yaml:"plot,omitempty"`
		Director     null.String  `boil:"director" json:"director,omitempty" toml:"director" yaml:"director,omitempty"`
		Writer       null.String  `boil:"writer" json:"writer,omitempty" toml:"writer" yaml:"writer,omitempty"`
		Actors       null.String  `boil:"actors" json:"actors,omitempty" toml:"actors" yaml:"actors,omitempty"`
		Released     null.String  `boil:"released" json:"released,omitempty" toml:"released" yaml:"released,omitempty"`
		ReleasedUnix null.Int64   `boil:"released_unix" json:"released_unix,omitempty" toml:"released_unix" yaml:"released_unix,omitempty"`
		Trailer      null.String  `boil:"trailer" json:"trailer,omitempty" toml:"trailer" yaml:"trailer,omitempty"`
		Type         null.String  `boil:"type" json:"type,omitempty" toml:"type" yaml:"type,omitempty"`
		Name         null.String  `boil:"name" json:"name,omitempty" toml:"name" yaml:"name,omitempty"`
		IsWatched    null.Bool    `boil:"isWatched" json:"isWatched,omitempty"`
		DownloadedAt null.String  `boil:"downloadedAt" json:"downloadedAt,omitempty"`
	}
	var media []MediaWithDownloadedAt
	err := models.NewQuery(
		qm.Select("md.*, max(mf.downloadedAt) as downloadedAt, umd.isWatched as isWatched"),
		qm.From("metaData as md"),
		qm.LeftOuterJoin("mediaFile as mf on mf.metaDataId = md.id"),
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = 1"),
		qm.GroupBy("md.id"),
		qm.OrderBy(" max(mf.downloadedAt) DESC"),
	).BindG(context.Background(), &media)
	if err != nil {
		transmitPromiseReject(c, data, fmt.Sprintf("could not get media %s", err))
		return
	}

	transmitPromiseResponse(c, data, media)
}

func (s *Server) GetAllEpisodes(c *websocket.Conn, req PayloadRequest) {
	p := req.Data.(map[string]interface{})["metaDataId"]
	spew.Dump(p)
	episodes, err := models.Episodes(
		qm.Where("metaDataId = ?", p),
		qm.Load(models.EpisodeRels.MetaDataIdMetaDatum),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes,
			qm.Where("userId = ?", 1),
		),
		qm.Load(models.EpisodeRels.EpisodeIdMediaFiles),
	).AllG(context.Background())
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get episodes 2 %s", err))
		return
	}
	type Result struct {
		*models.Episode
		MetaData    *models.MetaDatum   `json:"metaData"`
		UserEpisode *models.UserEpisode `json:"userEpisode"`
		MediaFiles  []*models.MediaFile `json:"mediaFiles"`
		IsWatched   bool                `json:"isWatched"`
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
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get media files %s", err))
		return
	}
	transmitPromiseResponse(c, req, mediaFiles)
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
		qm.LeftOuterJoin("userMetaData as umd on umd.metaDataId = md.id and umd.userId = 1"),
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
			qm.LeftOuterJoin("userEpisode as ue on ue.episodeId = ep.id and ue.userId = 1"),
			qm.LeftOuterJoin("metaData as md on md.id = ep.metaDataId"),
			//qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes, qm.Where("userId = ?", 1)),
		).BindG(context.Background(), &tmp)
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not find episode in db %s", err))
			return
		}
		//tmp["userEpisode"] = episode
		//tmp["isAlreadyWatched"] = episode.isWatched.Bool
		//tmp["isAlreadyWatched"] = episode.(*models.Episode).R.EpisodeIdUserEpisodes[0].IsWatched.Bool
	}
	transmitPromiseResponse(c, req, tmp)
}

func (s *Server) setWatchedEpisode(c *websocket.Conn, req PayloadRequest, entityId int64, isWatched bool) {
	episode, err := models.FindEpisodeG(context.Background(), null.Int64From(entityId))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not find episode %s", err))
		return
	}

	// Check if userEpisode already exists
	uep, err := models.UserEpisodes(
		qm.Where("episodeId = ?", entityId),
		qm.Where("userId = ?", 1),
	).OneG(context.Background())
	if err == nil {
		// update existing
		uep.IsWatched = null.BoolFrom(isWatched)
		_, err = uep.UpdateG(context.Background(), boil.Infer())
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("could not update user episode %s", err))
			return
		}
		transmitPromiseResponse(c, req, "episode updated")
		return
	}

	// create new
	err = episode.AddEpisodeIdUserEpisodesG(context.Background(), true, &models.UserEpisode{
		UserId:    null.Int64From(1),
		IsWatched: null.BoolFrom(isWatched),
	})
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not create user episode data %s", err))
		return
	}
	transmitPromiseResponse(c, req, "episode updated")
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
		qm.Where("userId = ?", 1),
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

func transmitPromiseResponse(c *websocket.Conn, req PayloadRequest, data interface{}) {
	response := PayloadResponse{
		ReplyChannel: req.ReplyChannel,
		Status:       StatusSuccess,
		Data:         data,
	}
	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling result:", err)
		return
	}
	err = c.WriteMessage(websocket.TextMessage, jsonResult)
	if err != nil {
		log.Println("Error writing message:", err)
	}
}

func transmitPromiseReject(c *websocket.Conn, req PayloadRequest, data interface{}) {
	response := PayloadResponse{
		ReplyChannel: req.ReplyChannel,
		Status:       StatusFailure,
		Data:         data,
	}
	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling result:", err)
		return
	}
	err = c.WriteMessage(websocket.TextMessage, jsonResult)
	if err != nil {
		log.Println("Error writing message:", err)
	}
}
