package server

import (
	"fmt"
	"github.com/gorilla/websocket"
	"go-poc/walker"
	"log"
	"net/http"
	"sync"
	"time"
)

func StartWebServer() {
	http.Handle("/", http.FileServer(http.Dir("static")))
	http.HandleFunc("/ws", wsHandler)

	go func() {
		for {
			fmt.Println("broadcasting to all clients")
			// Example: broadcast a message every 9 seconds
			BroadcastMessage("Hello, clients!")
			time.Sleep(9 * time.Second)
		}
	}()

	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		panic(err)
	}
}

// Define the upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Store active WebSocket connections
var clients = make(map[*websocket.Conn]bool)
var mutex = &sync.Mutex{}

// WebSocket handler
func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error upgrading to websocket:", err)
		return
	}
	defer conn.Close()

	// Add the new connection to the clients map
	mutex.Lock()
	clients[conn] = true
	fmt.Println("Adding new client to clients map", len(clients))
	mutex.Unlock()

	for {

		conn.SetCloseHandler(func(code int, text string) error {
			log.Println("Connection closed:", code, text)
			mutex.Lock()
			delete(clients, conn)
			mutex.Unlock()
			return nil
		})

		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Error reading message:", err)
			break
		}
		log.Printf("Received: %s", message)

		if string(message) == "sweep" {
			go walker.FullSweep()
			continue
		}

		if string(message) == "ping" {
			log.Println("Received ping message")
			if err := conn.WriteMessage(messageType, []byte("pong")); err != nil {
				log.Println("Error writing message:", err)
				break
			}
			continue
		}

		if err := conn.WriteMessage(messageType, message); err != nil {
			log.Println("Error writing message:", err)
			break
		}
	}

	// Remove the connection from the clients map when done
	mutex.Lock()
	delete(clients, conn)
	fmt.Println("Removing client from clients map", len(clients))
	mutex.Unlock()
}

// Function to broadcast messages to all clients
func BroadcastMessage(message string) {
	mutex.Lock()
	defer mutex.Unlock()
	log.Println("Broadcasting message to num of clients: ", len(clients))
	for client := range clients {
		err := client.WriteMessage(websocket.TextMessage, []byte(message))
		if err != nil {
			log.Println("Error writing message:", err)
			client.Close()
			delete(clients, client)
		}
	}
}
