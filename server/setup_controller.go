package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/gorilla/websocket"

	"go-poc/config"
)

// First-run setup. While it is pending the setup-* routes are open to the
// wizard; once it completes they refuse, so nobody on the LAN can rewrite
// the config or browse the disk afterwards.
var setup struct {
	sync.Mutex
	pending bool
	initial config.Config
	done    chan config.Config
}

// RequireSetup opens the setup wizard, starting it from cfg, and returns a
// channel that delivers the config once the wizard has saved it.
func RequireSetup(cfg config.Config) <-chan config.Config {
	setup.Lock()
	defer setup.Unlock()
	setup.pending = true
	setup.initial = cfg
	setup.done = make(chan config.Config, 1)
	return setup.done
}

func setupPending() bool {
	setup.Lock()
	defer setup.Unlock()
	return setup.pending
}

// decodeData unmarshals a request's data into v.
func decodeData(req PayloadRequest, v interface{}) error {
	b, err := json.Marshal(req.Data)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// onSetup registers a route that only answers while setup is pending.
func (s *Server) onSetup(route string, callback func(*websocket.Conn, PayloadRequest)) {
	s.on(route, func(c *websocket.Conn, req PayloadRequest) {
		if !setupPending() {
			transmitPromiseReject(c, req, "setup is already complete")
			return
		}
		callback(c, req)
	})
}

func (s *Server) setSetupRoutes() {
	s.on("get-setup", s.GetSetup)
	s.onSetup("setup-check-tmdb-key", s.SetupCheckTmdbKey)
	s.onSetup("setup-list-dirs", s.SetupListDirs)
	s.onSetup("setup-complete", s.SetupComplete)
}

// GetSetup tells the app whether to show the setup wizard, and what to start it with.
func (s *Server) GetSetup(c *websocket.Conn, req PayloadRequest) {
	if !setupPending() {
		transmitPromiseResponse(c, req, map[string]interface{}{"needsSetup": false})
		return
	}
	setup.Lock()
	cfg := setup.initial
	setup.Unlock()
	transmitPromiseResponse(c, req, map[string]interface{}{
		"needsSetup": true,
		"config":     cfg,
		"pathSep":    string(filepath.Separator),
	})
}

// SetupCheckTmdbKey asks TMDB whether the key works.
func (s *Server) SetupCheckTmdbKey(c *websocket.Conn, req PayloadRequest) {
	var data struct {
		Key string `json:"key"`
	}
	if err := decodeData(req, &data); err != nil || strings.TrimSpace(data.Key) == "" {
		transmitPromiseReject(c, req, "Enter a TMDB API key")
		return
	}
	client, err := tmdb.Init(strings.TrimSpace(data.Key))
	if err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	client.SetClientConfig(http.Client{Timeout: 15 * time.Second})
	if _, err := client.GetConfigurationAPI(); err != nil {
		log.Println("TMDB key check failed:", err)
		if strings.Contains(err.Error(), "Invalid API key") {
			transmitPromiseReject(c, req, `TMDB did not accept this key. Copy the "API Key", not the longer "API Read Access Token".`)
		} else {
			transmitPromiseReject(c, req, "Could not reach TMDB to check the key. Check the internet connection and try again.")
		}
		return
	}
	transmitPromiseResponse(c, req, "ok")
}

// SetupListDirs lists the folders inside path for the wizard's folder
// browser. An empty path lists the drives (or / outside Windows).
func (s *Server) SetupListDirs(c *websocket.Conn, req PayloadRequest) {
	var data struct {
		Path string `json:"path"`
	}
	if err := decodeData(req, &data); err != nil {
		transmitPromiseReject(c, req, "invalid request")
		return
	}

	dirs := []string{}
	path := strings.TrimSpace(data.Path)
	parent := ""
	if path == "" && runtime.GOOS == "windows" {
		for letter := 'A'; letter <= 'Z'; letter++ {
			drive := string(letter) + `:\`
			if _, err := os.Stat(drive); err == nil {
				dirs = append(dirs, drive)
			}
		}
	} else {
		if path == "" {
			path = "/"
		}
		path = filepath.Clean(path)
		if runtime.GOOS == "windows" && strings.HasSuffix(path, ":") {
			path += `\`
		}
		entries, err := os.ReadDir(path)
		if err != nil {
			transmitPromiseReject(c, req, fmt.Sprintf("Cannot open %s", path))
			return
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() && !strings.HasPrefix(name, ".") && !strings.HasPrefix(name, "$") {
				dirs = append(dirs, filepath.Join(path, name))
			}
		}
		sort.Slice(dirs, func(i, j int) bool { return strings.ToLower(dirs[i]) < strings.ToLower(dirs[j]) })
		if p := filepath.Dir(path); p != path {
			parent = p
		}
	}
	transmitPromiseResponse(c, req, map[string]interface{}{"path": path, "parent": parent, "dirs": dirs})
}

// SetupComplete saves the wizard's config and lets the app start with it.
func (s *Server) SetupComplete(c *websocket.Conn, req PayloadRequest) {
	var cfg config.Config
	if err := decodeData(req, &cfg); err != nil {
		transmitPromiseReject(c, req, "invalid settings")
		return
	}
	cfg.TmdbApiKey = strings.TrimSpace(cfg.TmdbApiKey)
	if err := cfg.Validate(); err != nil {
		transmitPromiseReject(c, req, err.Error())
		return
	}
	if users, err := listUsers(); err != nil || len(users) == 0 {
		transmitPromiseReject(c, req, "Add at least one user")
		return
	}

	setup.Lock()
	defer setup.Unlock()
	if !setup.pending {
		transmitPromiseReject(c, req, "setup is already complete")
		return
	}
	if err := config.Save(cfg); err != nil {
		transmitPromiseReject(c, req, fmt.Sprintf("Could not save the settings: %v", err))
		return
	}
	setup.pending = false
	setup.done <- cfg
	transmitPromiseResponse(c, req, "ok")
}
