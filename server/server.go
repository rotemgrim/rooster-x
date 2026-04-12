package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

type Sweeper interface {
	FullSweep()
}

type Server struct {
	staticDir       string
	clients         map[*websocket.Conn]bool
	mutex           *sync.Mutex
	walker          Sweeper
	torrentsFetcher Sweeper
}

//go:embed static
var static embed.FS

func Assets() (fs.FS, error) {
	return fs.Sub(static, "static")
}

func NewServer(staticDir string) *Server {
	return &Server{
		staticDir:       staticDir,
		clients:         make(map[*websocket.Conn]bool),
		mutex:           &sync.Mutex{},
		walker:          nil,
		torrentsFetcher: nil,
	}
}

func (s *Server) Start(walker Sweeper, fetcher Sweeper) {
	s.walker = walker
	s.torrentsFetcher = fetcher
	s.SetRoutes()
	go func() {
		// Use the file system to serve static files
		assets, _ := Assets()
		assetsFS := http.FileServer(http.FS(assets))
		http.Handle("/", http.StripPrefix("/", assetsFS))

		// Serve icons folder from filesystem
		iconsFS := http.FileServer(http.Dir("icons"))
		http.Handle("/icons/", http.StripPrefix("/icons/", iconsFS))

		http.HandleFunc("/ws", s.wsHandler)
		http.HandleFunc("/stream/", streamProxyHandler)
		http.HandleFunc("/stream-ts/", streamSegmentHandler)
	}()

	//go func() {
	//	for {
	//		log.Println("broadcasting to all clients")
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
	log.Println("Adding new client to clients map", len(s.clients))
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
		s.RouteMessage(messageType, message, conn)
	}

	// Remove the connection from the clients map when done
	s.mutex.Lock()
	delete(s.clients, conn)
	log.Println("Removing client from clients map", len(s.clients))
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

	//payload :=

	response := MsgResponse{
		Status: StatusMsg,
		Data:   message,
	}

	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling message:", err)
		return
	}

	for client := range s.clients {
		err = client.WriteMessage(websocket.TextMessage, jsonResult)
		if err != nil {
			log.Println("Error writing message:", err)
			client.Close()
			delete(s.clients, client)
		}
		log.Printf("broadcasted message: %s\n", message)
	}
}

// streamProxyClient with connection pooling for the stream proxy
var streamProxyClient = &http.Client{
	// Don't follow redirects automatically for .m3u8 — we need to capture the redirect target
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// streamFollowClient follows redirects normally (for .ts segments)
var streamFollowClient = &http.Client{}

// streamProxyHandler proxies stream requests to the Xtream server to avoid CORS.
// URL format: /stream/live/{username}/{password}/{stream_id}.m3u8
func streamProxyHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.Path, "/stream/")
	if remotePath == "" {
		http.Error(w, "invalid stream path", http.StatusBadRequest)
		return
	}

	targetURL := fmt.Sprintf("%s/%s", xtreamServer, remotePath)

	if strings.HasSuffix(r.URL.Path, ".m3u8") {
		proxyM3U8(w, targetURL)
	} else {
		proxyPassthrough(w, targetURL)
	}
}

// streamSegmentHandler proxies .ts segment requests to the actual stream host.
// URL format: /stream-ts/{host}/{path}
func streamSegmentHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.Path, "/stream-ts/")
	if remotePath == "" {
		http.Error(w, "invalid segment path", http.StatusBadRequest)
		return
	}
	targetURL := "http://" + remotePath
	proxyPassthrough(w, targetURL)
}

func proxyM3U8(w http.ResponseWriter, targetURL string) {
	// First request may redirect — follow manually to capture the final host
	resp, err := streamProxyClient.Get(targetURL)
	if err != nil {
		log.Println("Stream proxy error:", err)
		http.Error(w, "failed to fetch stream", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Follow redirect if present
	finalHost := ""
	if resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusMovedPermanently || resp.StatusCode == http.StatusTemporaryRedirect {
		location := resp.Header.Get("Location")
		if location != "" {
			resp2, err := streamFollowClient.Get(location)
			if err != nil {
				log.Println("Stream proxy redirect error:", err)
				http.Error(w, "failed to follow redirect", http.StatusBadGateway)
				return
			}
			resp.Body.Close()
			resp = resp2
			// Extract host from the final URL
			if resp.Request != nil && resp.Request.URL != nil {
				finalHost = resp.Request.URL.Host
			}
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Stream proxy read error:", err)
		http.Error(w, "failed to read stream", http.StatusBadGateway)
		return
	}

	// Rewrite segment URLs to go through our proxy
	lines := strings.Split(string(body), "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "://") {
			// Absolute URL — proxy through /stream-ts/
			trimmed = strings.TrimPrefix(trimmed, "http://")
			trimmed = strings.TrimPrefix(trimmed, "https://")
			lines[i] = "/stream-ts/" + trimmed
		} else if finalHost != "" {
			// Relative/absolute path — prepend the redirected host
			lines[i] = "/stream-ts/" + finalHost + trimmed
		}
	}

	rewritten := []byte(strings.Join(lines, "\n"))
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write(rewritten)
}

func proxyPassthrough(w http.ResponseWriter, targetURL string) {
	resp, err := streamFollowClient.Get(targetURL)
	if err != nil {
		log.Println("Stream proxy error:", err)
		http.Error(w, "failed to fetch segment", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
