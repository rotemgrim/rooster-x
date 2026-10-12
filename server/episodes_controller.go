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

// RematchTorrentFn is wired up by main.go to gtmdb.RematchTorrent, like
// EnrichMetadataFn.
var RematchTorrentFn func(torrentId, tmdbId int64) (title string, moved int, err error)

// SearchTorrentTitlesFn is wired up by main.go to gtmdb.SearchTitlesForTorrent.
var SearchTorrentTitlesFn func(torrentId int64, query string) (interface{}, error)

// SearchTorrentTitles lists the TMDB titles a torrent can be linked to.
func (s *Server) SearchTorrentTitles(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["torrentId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "torrentId is required")
		return
	}
	query, _ := payload["query"].(string)
	titles, err := SearchTorrentTitlesFn(int64(idF), query)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not search titles: %s", err))
		return
	}
	transmitPromiseResponse(c, req, titles)
}

// RematchTorrent links a torrent that was matched to the wrong title to another
// one: the TMDB title tmdbId when given, otherwise one found by searching.
func (s *Server) RematchTorrent(c *websocket.Conn, req PayloadRequest) {
	payload, ok := req.Data.(map[string]interface{})
	if !ok {
		transmitPromiseReject(c, req, "invalid payload")
		return
	}
	idF, ok := payload["torrentId"].(float64)
	if !ok {
		transmitPromiseReject(c, req, "torrentId is required")
		return
	}
	tmdbIdF, _ := payload["tmdbId"].(float64)
	title, moved, err := RematchTorrentFn(int64(idF), int64(tmdbIdF))
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not rematch torrent: %s", err))
		return
	}
	if moved == 1 {
		s.BroadcastMessage(fmt.Sprintf("Moved the torrent to %s", title))
	} else {
		s.BroadcastMessage(fmt.Sprintf("Moved %d torrents to %s", moved, title))
	}
	transmitPromiseResponse(c, req, map[string]interface{}{"title": title, "moved": moved})
}
