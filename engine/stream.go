package engine

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// StreamHandler serves a file from a torrent over HTTP with Range support
// while it is still downloading. Reads block until the requested pieces
// arrive, and the reader prioritises pieces just ahead of the play position,
// so a player can start before the download finishes.
//
// URL shape: <prefix><infoHash>/<fileIndex>[/<display-name.ext>]
func StreamHandler(prefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, prefix), "/", 3)
		if len(parts) < 2 {
			http.Error(w, "expected /<infoHash>/<fileIndex>", http.StatusBadRequest)
			return
		}
		t, err := find(parts[0])
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		idx, err := strconv.Atoi(parts[1])
		if err != nil {
			http.Error(w, "invalid file index", http.StatusBadRequest)
			return
		}

		select {
		case <-t.GotInfo():
		case <-r.Context().Done():
			return
		}
		files := t.Files()
		if idx < 0 || idx >= len(files) {
			http.Error(w, "file index out of range", http.StatusNotFound)
			return
		}
		f := files[idx]

		reader := f.NewReader()
		defer reader.Close()
		reader.SetResponsive()
		reader.SetReadahead(16 << 20)
		reader.SetContext(r.Context())

		w.Header().Set("Access-Control-Allow-Origin", "*")
		// ServeContent handles Range / 206 and sets Content-Type from the name.
		http.ServeContent(w, r, f.DisplayPath(), time.Time{}, reader)
	}
}
