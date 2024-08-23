package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/davecgh/go-spew/spew"
	"github.com/friendsofgo/errors"
	"github.com/gorilla/websocket"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/models"
	"log"
	"os/exec"
	"runtime"
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
	media, err := models.MetaData(
		qm.Load(models.MetaDatumRels.MetaDataIdMediaFiles),
		qm.Load(models.MetaDatumRels.MetaDataIdTorrentFiles),
	).AllG(context.Background())
	type Result struct {
		*models.MetaDatum
		//MediaFiles   []*models.MediaFile   `json:"mediaFiles"`
		//TorrentFiles []*models.TorrentFile `json:"torrentFiles"`
	}
	if err != nil {
		transmitPromiseReject(c, data, "could not get media")
		return
	}
	//spew.Dump(media)
	var result = []Result{}
	for _, e := range media {
		result = append(result, Result{
			e,
			//e.R.GetMetaDataIdMediaFiles(),
			//e.R.GetMetaDataIdTorrentFiles(),
		})
	}
	transmitPromiseResponse(c, data, result)
}

func (s *Server) GetAllEpisodes(c *websocket.Conn, req PayloadRequest) {
	p := req.Data.(map[string]interface{})["metaDataId"]
	spew.Dump(p)
	episodes, err := models.Episodes(
		qm.Where("metaDataId = ?", p),
		qm.Load(models.EpisodeRels.MetaDataIdMetaDatum),
		qm.Load(models.EpisodeRels.EpisodeIdUserEpisodes, qm.Where("userId = ?", 1)),
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
	err := runFile(path.(string))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not open external %s", err))
	}
	transmitPromiseResponse(c, req, "Opening external")
}

func (s *Server) RouteNotFound(c *websocket.Conn, data PayloadRequest) {
	transmitPromiseReject(c, data, "Route not found")
}

func runFile(filePath string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", filePath)
	case "darwin":
		cmd = exec.Command("open", filePath)
	case "linux":
		cmd = exec.Command("xdg-open", filePath)
	default:
		return errors.New("unsupported platform")
	}

	err := cmd.Start()
	return err
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
