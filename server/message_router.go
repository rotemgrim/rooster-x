package server

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"log"
)

type PayloadRequest struct {
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
	s.on("set-watched", s.SetWatched)
	s.on("get-meta-data-by-file-id", s.GetMetaDataByFileId)
	s.on("reprocess-genres", s.ReprocessGenresRequest)
	s.on("get-all-genres", s.GetAllGenres)

	s.on("get-trailer", s.GetTrailer)
	s.on("get-imdb-rating", s.GetImdbRating)
}

func (s *Server) RouteMessage(messageType int, message []byte, conn *websocket.Conn) {
	log.Printf("Received: %s", message)

	switch string(message) {
	case "sweep":
		s.walker.FullSweep()
		return
	case "ping":
		log.Println("Received ping message")
		if err := conn.WriteMessage(messageType, []byte("pong")); err != nil {
			log.Println("Error writing message:", err)
		}
		return
	default:
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
}

func (s *Server) on(route string, callback func(*websocket.Conn, PayloadRequest)) {
	routes[route] = callback
}
