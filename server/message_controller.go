package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/davecgh/go-spew/spew"
	"github.com/gorilla/websocket"
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
	println("media1")

	type MediaFileAndMetaData struct {
		models.MediaFile `boil:",bind"`
		models.MetaDatum `boil:",bind"`
	}

	//media, err := models.MediaFiles(qm.Load(models.MetaDatumRels.MetaDataIdMediaFiles)).AllG(context.Background())
	var media []MediaFileAndMetaData
	err := models.NewQuery(
		qm.Select("mf.*, md.*"),
		qm.From("mediaFile as mf"),
		qm.InnerJoin("metaData as md on mf.metaDataId = md.id"),
	).BindG(context.Background(), &media)
	spew.Dump(media)
	if err != nil {
		transmitPromiseReject(c, data, "could not get media")
		return
	}
	spew.Dump(media)
	if media == nil {
		media = []MediaFileAndMetaData{}
	}
	transmitPromiseResponse(c, data, media)
}

func (s *Server) GetAllEpisodes(c *websocket.Conn, req PayloadRequest) {
	println("episodes")
	//spew.Dump(req)
	//spew.Dump(req.Data)
	//spew.Dump(req.Data.([]byte))
	//type payload struct {
	//	MetaDataId int `json:"metaDataId"`
	//}
	//var p = &payload{}
	//err := json.Unmarshal(req.Data.([]byte), p)
	//if err != nil {
	//	transmitPromiseReject(c, req, "could not get episodes")
	//	return
	//}
	p := req.Data.(map[string]interface{})["metaDataId"]
	spew.Dump(p)
	episodes, err := models.Episodes(
		qm.Where("metaDataId = ?", p),
		//qm.Load("EpisodeIdMediaFiles"),
		//qm.Load("MetaDataIdMetaDatum"),
		qm.Load(models.EpisodeRels.MetaDataIdMetaDatum),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes, qm.Where("userId = ?", 1)),
		qm.Load(models.EpisodeRels.EpisodeIdMediaFiles),
	).AllG(context.Background())
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not get episodes 2 %s", err))
		return
	}
	type oneResult struct {
		episode  *models.Episode
		metaData *models.MetaDatum
	}
	var result = []map[string]interface{}(nil)
	for _, e := range episodes {
		result = append(result, map[string]interface{}{
			"episode":     e,
			"metaData":    e.R.MetaDataIdMetaDatum,
			"userEpisode": e.R.EpisodeIdUserEpisodes,
			"mediaFiles":  e.R.EpisodeIdMediaFiles,
		})
	}
	//spew.Dump(result)
	//type result struct {
	//	Episodes models.EpisodeSlice       `json:"episodes"`
	//	MetaData *models.MetaDatum         `json:"metaData"`
	//	UserMeta models.UserMetaDatumSlice `json:"userMetaDatum"`
	//}
	//var r = result{
	//	Episodes: episodes,
	//	MetaData: episodes[0].R.MetaDataIdMetaDatum,
	//	UserMeta: episodes[0].R.MetaDataIdMetaDatum.R.MetaDataIdUserMetaData,
	//}
	transmitPromiseResponse(c, req, result)
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
