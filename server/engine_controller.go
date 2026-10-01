package server

import (
	"fmt"

	"github.com/gorilla/websocket"

	"go-poc/engine"
)

// EngineAdd starts downloading a magnet in the embedded torrent engine.
func (s *Server) EngineAdd(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	magnet, _ := data["magnet"].(string)
	if magnet == "" {
		transmitPromiseReject(c, req, "magnet is required")
		return
	}
	hash, err := engine.Add(magnet)
	if err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("could not add torrent: %s", err))
		return
	}
	transmitPromiseResponse(c, req, hash)
}

// EngineStatus returns one torrent when infoHash is given, otherwise all of them.
func (s *Server) EngineStatus(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	if hash, _ := data["infoHash"].(string); hash != "" {
		st, err := engine.Get(hash)
		if err != nil {
			transmitPromiseReject(c, req, err.Error())
			return
		}
		transmitPromiseResponse(c, req, st)
		return
	}
	transmitPromiseResponse(c, req, engine.List())
}

// EngineSetSequential toggles first/last-parts-first + in-order downloading.
func (s *Server) EngineSetSequential(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	hash, _ := data["infoHash"].(string)
	on, _ := data["sequential"].(bool)
	if err := engine.SetSequential(hash, on); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	transmitPromiseResponse(c, req, on)
}

// EngineRemove stops a torrent; downloaded files stay on disk.
func (s *Server) EngineRemove(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	hash, _ := data["infoHash"].(string)
	if err := engine.Remove(hash); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	transmitPromiseResponse(c, req, "removed")
}
