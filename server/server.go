package server

import (
	"fmt"
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"sync"
)

type Sweeper interface {
	FullSweep()
}

type Server struct {
	staticDir string
	clients   map[*websocket.Conn]bool
	mutex     *sync.Mutex
	walker    Sweeper
}

func NewServer(staticDir string) *Server {
	return &Server{
		staticDir: staticDir,
		clients:   make(map[*websocket.Conn]bool),
		mutex:     &sync.Mutex{},
		walker:    nil,
	}
}

func (s *Server) Start(walker Sweeper) {
	s.walker = walker

	go func() {
		http.Handle("/", http.FileServer(http.Dir(s.staticDir)))
		http.HandleFunc("/ws", s.wsHandler)
	}()

	//go func() {
	//	for {
	//		fmt.Println("broadcasting to all clients")
	//		// Example: broadcast a message every 9 seconds
	//		s.BroadcastMessage("Hello, clients!")
	//		time.Sleep(9 * time.Second)
	//	}
	//}()

	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		panic(err)
	}
}

func (s *Server) wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error upgrading to websocket:", err)
		return
	}
	defer conn.Close()

	// Add the new connection to the clients map
	s.mutex.Lock()
	s.clients[conn] = true
	fmt.Println("Adding new client to clients map", len(s.clients))
	s.mutex.Unlock()

	for {

		conn.SetCloseHandler(func(code int, text string) error {
			log.Println("Connection closed:", code, text)
			s.mutex.Lock()
			delete(s.clients, conn)
			s.mutex.Unlock()
			return nil
		})

		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Error reading message:", err)
			break
		}
		log.Printf("Received: %s", message)

		if string(message) == "sweep" {
			s.walker.FullSweep()
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
	s.mutex.Lock()
	delete(s.clients, conn)
	fmt.Println("Removing client from clients map", len(s.clients))
	s.mutex.Unlock()
}

// Define the upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// BroadcastMessage Function to broadcast messages to all clients
func (s Server) BroadcastMessage(message string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	for client := range s.clients {
		err := client.WriteMessage(websocket.TextMessage, []byte(message))
		if err != nil {
			//log.Println("Error writing message:", err)
			client.Close()
			delete(s.clients, client)
		}
	}
}
