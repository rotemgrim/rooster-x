package server

import (
	"fmt"

	"github.com/gorilla/websocket"
)

// RefreshEpisodesFn is wired up by main.go to gtmdb.RefreshEpisodes, like
// EnrichMetadataFn.
var RefreshEpisodesFn func(metaDataId int64) (missing, filled int, err error)

// RefreshEpisodes re-fetches a series' episodes that have no still or plot
// from TMDB.
func (s *Server) RefreshEpisodes(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["metaDataId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "metaDataId is required")
		return
	}
	missing, filled, err := RefreshEpisodesFn(int64(idF))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not refresh episodes: %s", err))
		return
	}
	transmitPromiseResponse(c, req, map[string]int{"missing": missing, "filled": filled})
}
