package server

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"log"
)

type PayloadRequest struct {
	UserId       int         `json:"userId"`
	ReplyChannel string      `json:"replyChannel"`
	Route        string      `json:"route"`
	Data         interface{} `json:"data"`
}

var routes = make(map[string]func(*websocket.Conn, PayloadRequest))

func (s *Server) SetRoutes() {
	s.on("full-sweep", s.FullSweep)
	s.on("sync-torrents", s.SyncTorrents)
	s.on("get-config", s.GetConfig)
	s.on("get-all-users", s.GetAllUsers)
	s.on("save-config", s.SaveConfig)
	s.on("get-media", s.GetAllMedia)
	s.on("get-episodes", s.GetAllEpisodes)
	s.on("get-media-files", s.GetMediaFilesByMetaId)
	s.on("open-external", s.OpenExternal)
	s.on("open-in-mpv", s.OpenInMPV)
	s.on("engine-add", s.EngineAdd)
	s.on("engine-status", s.EngineStatus)
	s.on("engine-remove", s.EngineRemove)
	s.on("engine-pause", s.EnginePause)
	s.on("engine-set-sequential", s.EngineSetSequential)
	s.on("engine-get-settings", s.EngineGetSettings)
	s.on("engine-save-settings", s.EngineSaveSettings)
	s.on("set-watched", s.SetWatched)
	s.on("get-meta-data-by-file-id", s.GetMetaDataByFileId)
	s.on("get-meta-data", s.GetMetaDataById)
	s.on("reprocess-genres", s.ReprocessGenresRequest)
	s.on("get-all-genres", s.GetAllGenres)

	s.on("get-trailer", s.GetTrailer)
	s.on("get-imdb-rating", s.GetImdbRating)
	s.on("enrich-metadata", s.EnrichMetaData)

	s.on("get-channels", s.GetChannels)
	s.on("fetch-channel-icon", s.FetchChannelIcon)

	// Lists (per-user playlists of metaData items)
	s.on("get-lists", s.GetLists)
	s.on("create-list", s.CreateList)
	s.on("update-list", s.UpdateList)
	s.on("delete-list", s.DeleteList)
	s.on("get-list-items", s.GetListItems)
	s.on("add-list-item", s.AddListItem)
	s.on("remove-list-item", s.RemoveListItem)
	s.on("reorder-list-items", s.ReorderListItems)
	s.on("get-lists-containing", s.GetListsContaining)

	// MPV watch progress
	s.on("get-watch-progress", s.GetWatchProgress)
	s.on("get-watch-progress-bulk", s.GetWatchProgressBulk)
}

func (s *Server) RouteMessage(messageType int, message []byte, conn *websocket.Conn) {
	log.Printf("Received: %s", message)

	// marshal the message to a struct
	var payload PayloadRequest
	err := json.Unmarshal(message, &payload)
	if err != nil {
		log.Println("Error unmarshalling message:", err)
		return
	}

	// route the message into different functions
	if callback, ok := routes[payload.Route]; ok {
		callback(conn, payload)
	} else {
		log.Println("Route not found")
		s.RouteNotFound(conn, payload)
	}

}

func (s *Server) on(route string, callback func(*websocket.Conn, PayloadRequest)) {
	routes[route] = callback
}
