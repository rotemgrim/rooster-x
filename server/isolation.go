package server

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

const playerPage = "/player.html"

// isolationHandler makes the libmedia player page (and the player's own
// scripts and wasm) cross-origin isolated. That unlocks SharedArrayBuffer,
// which libmedia needs to decode on multiple threads. Browsers only honor
// these headers on a secure origin, so remote plain-HTTP requests for the
// player page are redirected to the HTTPS listener first.
//
// Only the player is isolated: COEP require-corp would block the TMDB
// posters and Google Fonts the main app loads cross-origin.
//
// renderer/vite.config.ts mirrors the headers for the dev server.
func isolationHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == playerPage && r.TLS == nil && !isLoopbackHost(r.Host) {
			http.Redirect(w, r, httpsURL(r).String(), http.StatusFound)
			return
		}
		if path == playerPage || strings.HasPrefix(path, "/libmedia/") {
			w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
			w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		}
		next.ServeHTTP(w, r)
	})
}

// httpsURL is the request's URL on the HTTPS listener of the same host.
func httpsURL(r *http.Request) *url.URL {
	return &url.URL{
		Scheme:   "https",
		Host:     net.JoinHostPort(hostname(r.Host), httpsPort),
		Path:     r.URL.Path,
		RawQuery: r.URL.RawQuery,
	}
}

// isLoopbackHost reports whether the browser addressed us as localhost,
// which browsers already treat as a secure origin over plain HTTP.
func isLoopbackHost(host string) bool {
	h := hostname(host)
	ip := net.ParseIP(h)
	return h == "localhost" || (ip != nil && ip.IsLoopback())
}

// hostname strips the port (and IPv6 brackets) from a Host header value.
func hostname(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.Trim(host, "[]")
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
