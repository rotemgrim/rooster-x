package server

// The live TV proxy: the browser can't fetch the Xtream provider's streams
// itself (no CORS), so /stream/ opens a channel and /stream-ts/ fetches its
// playlists and segments.

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

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

// streamRemotePath is where /stream-ts/ fetches u from. It is always fetched
// over http.
func streamRemotePath(u *url.URL) string {
	p := "/stream-ts/" + u.Host + u.EscapedPath()
	if u.RawQuery != "" {
		p += "?" + u.RawQuery
	}
	return p
}

// streamProxyHandler opens a channel: it asks the Xtream server for the
// channel's playlist and redirects the player, through /stream-ts/, to where
// the server sent it. hls.js reloads a live playlist at the URL it was
// redirected to, so the reloads stay on the provider session this request
// opened, as mpv's do; asking the Xtream server on every reload would open a
// new session every few seconds, and a provider allowing one connection
// drops the previous one's segments. A restarted player comes back here and
// gets a fresh session.
func streamProxyHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.Path, "/stream/")
	if remotePath == "" {
		http.Error(w, "invalid stream path", http.StatusBadRequest)
		return
	}

	resp, err := streamGet(streamNoRedirectClient, r, fmt.Sprintf("%s/%s", xtreamServer, remotePath))
	if err != nil {
		log.Println("Stream proxy error:", err)
		http.Error(w, "failed to fetch stream", http.StatusBadGateway)
		return
	}
	resp.Body.Close()
	// a server that doesn't redirect serves the playlist itself
	playlist, err := resp.Location()
	if err != nil {
		playlist = resp.Request.URL
	}
	http.Redirect(w, r, streamRemotePath(playlist), http.StatusFound)
}

// streamRemoteHandler proxies a stream's playlists and segments from the
// provider, pointing a playlist's URLs back through /stream-ts/.
func streamRemoteHandler(w http.ResponseWriter, r *http.Request) {
	remotePath := strings.TrimPrefix(r.URL.EscapedPath(), "/stream-ts/")
	if remotePath == "" {
		http.Error(w, "invalid stream path", http.StatusBadRequest)
		return
	}
	if r.URL.RawQuery != "" {
		remotePath += "?" + r.URL.RawQuery
	}

	resp, err := streamGet(streamClient, r, "http://"+remotePath)
	if err != nil {
		log.Println("Stream proxy error:", err)
		http.Error(w, "failed to fetch stream", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK && isPlaylist(resp) {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Println("Stream proxy read error:", err)
			http.Error(w, "failed to read stream", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write([]byte(rewritePlaylist(string(body), resp.Request.URL)))
		return
	}

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func isPlaylist(resp *http.Response) bool {
	return strings.HasSuffix(resp.Request.URL.Path, ".m3u8") ||
		strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "mpegurl")
}

// rewritePlaylist points a playlist's segment and variant URLs, which are
// relative to base, through /stream-ts/.
func rewritePlaylist(playlist string, base *url.URL) string {
	lines := strings.Split(playlist, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if u, err := base.Parse(trimmed); err == nil {
			lines[i] = streamRemotePath(u)
		}
	}
	return strings.Join(lines, "\n")
}
