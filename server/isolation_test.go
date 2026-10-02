package server

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsolationHandler(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := isolationHandler(ok)

	tests := []struct {
		name         string
		url          string
		tls          bool
		wantStatus   int
		wantLocation string
		wantIsolated bool
	}{
		{"remote http player redirects to https", "http://192.168.1.102:8080/player.html?src=%2Ffile%2F1", false,
			http.StatusFound, "https://192.168.1.102:" + httpsPort + "/player.html?src=%2Ffile%2F1", false},
		{"remote ipv6 http player redirects", "http://[fe80::1]:8080/player.html", false,
			http.StatusFound, "https://[fe80::1]:" + httpsPort + "/player.html", false},
		{"https player is isolated", "https://192.168.1.102:8443/player.html", true, http.StatusOK, "", true},
		{"localhost http player is isolated", "http://localhost:8080/player.html", false, http.StatusOK, "", true},
		{"loopback ip player is isolated", "http://127.0.0.1:8080/player.html", false, http.StatusOK, "", true},
		{"libmedia assets are isolated", "http://192.168.1.102:8080/libmedia/avplayer.js", false, http.StatusOK, "", true},
		{"main app is not isolated", "https://192.168.1.102:8443/", true, http.StatusOK, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tt.url, nil)
			if tt.tls {
				r.TLS = &tls.ConnectionState{}
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if got := w.Header().Get("Location"); got != tt.wantLocation {
				t.Errorf("Location = %q, want %q", got, tt.wantLocation)
			}
			if got := w.Header().Get("Cross-Origin-Embedder-Policy") == "require-corp"; got != tt.wantIsolated {
				t.Errorf("isolated = %v, want %v", got, tt.wantIsolated)
			}
		})
	}
}
