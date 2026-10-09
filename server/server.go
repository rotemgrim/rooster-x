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

	"go-poc/engine"
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

// httpsPort is the self-signed HTTPS listener, which remote devices need for
// secure-context features (clipboard, share, multithreaded playback).
const httpsPort = "8443"

//go:embed static
var static embed.FS

func Assets() (fs.FS, error) {
	return fs.Sub(static, "static")
}

// spaHandler serves static assets from the embedded FS and falls back to
// index.html for any path that does not match an existing file. This makes
// client-side routes (e.g. /movie/123) work on hard refresh.
func spaHandler(assets fs.FS, fileServer http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Let the file server handle the root and real files.
		reqPath := strings.TrimPrefix(r.URL.Path, "/")
		if reqPath == "" {
			fileServer.ServeHTTP(w, r)
			return
		}

		// If the file exists in the embedded FS, serve it normally.
		if f, err := assets.Open(reqPath); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Don't fall back for asset-like requests (they should 404 properly).
		if strings.Contains(reqPath, ".") {
			http.NotFound(w, r)
			return
		}

		// Fallback: serve index.html for SPA routes.
		indexBytes, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(indexBytes)
	})
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

// SetSweepers hands the server the library and torrent sweepers, which exist
// only once the app is configured.
func (s *Server) SetSweepers(walker Sweeper, fetcher Sweeper) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.walker = walker
	s.torrentsFetcher = fetcher
}

func (s *Server) sweepers() (walker Sweeper, fetcher Sweeper) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.walker, s.torrentsFetcher
}

func (s *Server) Start() {
	s.SetRoutes()
	go func() {
		// Use the file system to serve static files
		assets, _ := Assets()
		assetsFS := http.FileServer(http.FS(assets))

		// SPA fallback: if the requested file doesn't exist in the embedded
		// FS, serve index.html so the client-side router can take over on
		// hard refresh of routes like /movie/1202.
		http.Handle("/", isolationHandler(spaHandler(assets, assetsFS)))

		// Serve icons folder from filesystem
		iconsFS := http.FileServer(http.Dir("icons"))
		http.Handle("/icons/", http.StripPrefix("/icons/", iconsFS))

		http.HandleFunc("/ws", s.wsHandler)
		http.HandleFunc("/stream/", streamProxyHandler)
		http.HandleFunc("/stream-ts/", streamSegmentHandler)
		http.HandleFunc("/api/progress", progressHandler)
		// Serve local MediaFile bytes over HTTP (with Range support) so a
		// phone on the LAN can hand the URL to VLC / Infuse / nPlayer.
		http.HandleFunc("/file/", mediaFileHandler)
		http.HandleFunc("/roosterx.crt", certDownloadHandler)
		// Stream files from the embedded torrent engine while they download.
		http.HandleFunc("/engine/stream/", engine.StreamHandler("/engine/stream/"))
	}()

	//go func() {
	//	for {
	//		log.Println("broadcasting to all clients")
	//		// Example: broadcast a message every 9 seconds
	//		s.BroadcastMessage("Hello, clients!")
	//		time.Sleep(9 * time.Second)
	//	}
	//}()

	// Start HTTPS on httpsPort alongside HTTP on 8080. The phone needs HTTPS
	// to unlock navigator.share and navigator.clipboard (both are gated
	// on a "secure context"). The cert is self-signed so browsers show a
	// one-time "Not secure" warning - proceed through it once per device.
	go func() {
		certPath, keyPath, err := ensureSelfSignedCert()
		if err != nil {
			log.Println("HTTPS disabled -", err)
			return
		}
		log.Println("HTTPS listening on :"+httpsPort+" (self-signed cert at", certPath, ")")
		if err := http.ListenAndServeTLS(":"+httpsPort, certPath, keyPath, nil); err != nil {
			log.Println("HTTPS server stopped:", err)
		}
	}()

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
	defer wsWriteLocks.Delete(conn)
	// requests still running write to conn, so the write lock goes after them
	var inFlight sync.WaitGroup
	defer inFlight.Wait()

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
		// each request runs on its own, so a slow one (a tracker scrape, a
		// trailer lookup) doesn't hold up the ones sent after it
		inFlight.Add(1)
		go func() {
			defer inFlight.Done()
			s.RouteMessage(messageType, message, conn)
		}()
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

// wsWriteLocks holds one write lock per connection. gorilla/websocket allows a
// single concurrent writer, and replies (message handlers) and broadcasts
// (sweeps, torrent status) write to the same connection from different
// goroutines.
var wsWriteLocks sync.Map // *websocket.Conn -> *sync.Mutex

// writeWS sends a text frame, serialized with every other write to c.
func writeWS(c *websocket.Conn, payload []byte) error {
	mu, _ := wsWriteLocks.LoadOrStore(c, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()
	return c.WriteMessage(websocket.TextMessage, payload)
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
		err = writeWS(client, jsonResult)
		if err != nil {
			log.Println("Error writing message:", err)
			client.Close()
			delete(s.clients, client)
		}
		log.Printf("broadcasted message: %s\n", message)
	}
}

var streamClient = &http.Client{
	Transport: &http.Transport{
		MaxConnsPerHost: 2,
	},
}

// streamNoRedirectClient captures redirect targets without following them
var streamNoRedirectClient = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// streamGet fetches url for the player's request r and gives up when the
// player does. streamClient allows only two connections to the provider, so
// a segment the player abandoned (timed out, or the stream restarted) would
// otherwise hold one until the provider finished sending it, starving the
// segments the player is now waiting for.
func streamGet(client *http.Client, r *http.Request, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return client.Do(req)
}

// streamProxyHandler proxies .m3u8 manifest requests to the Xtream server.
// The Xtream server redirects to a different host; we follow the redirect,
// then rewrite segment URLs to route through /stream-ts/.
func streamProxyHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.Path, "/stream/")
	if remotePath == "" {
		http.Error(w, "invalid stream path", http.StatusBadRequest)
		return
	}

	targetURL := fmt.Sprintf("%s/%s", xtreamServer, remotePath)

	// Get the initial response (may be a redirect)
	resp, err := streamGet(streamNoRedirectClient, r, targetURL)
	if err != nil {
		log.Println("Stream proxy error:", err)
		http.Error(w, "failed to fetch stream", http.StatusBadGateway)
		return
	}

	// Follow redirect to capture the actual stream host
	finalHost := ""
	if location := resp.Header.Get("Location"); location != "" && (resp.StatusCode >= 300 && resp.StatusCode < 400) {
		resp.Body.Close()
		resp, err = streamGet(streamClient, r, location)
		if err != nil {
			log.Println("Stream proxy redirect error:", err)
			http.Error(w, "failed to follow redirect", http.StatusBadGateway)
			return
		}
		if resp.Request != nil && resp.Request.URL != nil {
			finalHost = resp.Request.URL.Host
		}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Println("Stream proxy read error:", err)
		http.Error(w, "failed to read stream", http.StatusBadGateway)
		return
	}

	// Rewrite segment URLs to go through our /stream-ts/ proxy
	lines := strings.Split(string(body), "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if strings.Contains(trimmed, "://") {
			trimmed = strings.TrimPrefix(trimmed, "http://")
			trimmed = strings.TrimPrefix(trimmed, "https://")
			lines[i] = "/stream-ts/" + trimmed
		} else if finalHost != "" {
			lines[i] = "/stream-ts/" + finalHost + trimmed
		}
	}

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write([]byte(strings.Join(lines, "\n")))
}

// streamSegmentHandler proxies .ts segment requests to the actual stream host.
func streamSegmentHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.Path, "/stream-ts/")
	if remotePath == "" {
		http.Error(w, "invalid segment path", http.StatusBadRequest)
		return
	}

	resp, err := streamGet(streamClient, r, "http://"+remotePath)
	if err != nil {
		log.Println("Segment proxy error:", err)
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
