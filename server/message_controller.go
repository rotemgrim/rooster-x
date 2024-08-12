package server

import (
	"context"
	"encoding/json"
	"github.com/gorilla/websocket"
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
	media, err := models.MetaData().AllG(context.Background())
	if err != nil {
		transmitPromiseReject(c, data, "could not get media")
		return
	}
	transmitPromiseResponse(c, data, media)
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
