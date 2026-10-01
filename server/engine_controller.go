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

// EnginePause pauses or resumes a torrent.
func (s *Server) EnginePause(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	hash, _ := data["infoHash"].(string)
	paused, _ := data["paused"].(bool)
	if err := engine.SetPaused(hash, paused); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	transmitPromiseResponse(c, req, paused)
}

// EngineRemove stops a torrent; with deleteFiles its downloaded files are
// deleted too.
func (s *Server) EngineRemove(c *websocket.Conn, req PayloadRequest) {
	data, _ := req.Data.(map[string]interface{})
	hash, _ := data["infoHash"].(string)
	deleteFiles, _ := data["deleteFiles"].(bool)
	if err := engine.Remove(hash, deleteFiles); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	transmitPromiseResponse(c, req, "removed")
}
