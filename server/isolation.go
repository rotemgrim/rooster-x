package server

import (
	"net/http"
	"strings"
)

// isolationHandler makes the libmedia player page (and the player's own
// scripts and wasm) cross-origin isolated. That unlocks SharedArrayBuffer,
// which libmedia needs to decode on multiple threads. Browsers only honor
// these headers over HTTPS (or on localhost), so remote clients get threads
// on :8443.
//
// Only the player is isolated: COEP require-corp would block the TMDB
// posters and Google Fonts the main app loads cross-origin.
func isolationHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/player.html" || strings.HasPrefix(r.URL.Path, "/libmedia/") {
			w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
			w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		}
		next.ServeHTTP(w, r)
	})
}

// certDownloadHandler serves the public self-signed certificate (never the
// key) so phones can install it as trusted. Chrome ignores COOP/COEP on
// pages with certificate errors, even after clicking through the warning,
// so multithreaded playback needs the cert trusted on each device.
func certDownloadHandler(w http.ResponseWriter, r *http.Request) {
	certPath, _, err := ensureSelfSignedCert()
	if err != nil {
		http.Error(w, "certificate unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="roosterx.crt"`)
	http.ServeFile(w, r, certPath)
}
