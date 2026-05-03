package server

import (
	"context"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"go-poc/db"
	"go-poc/models"

	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

// mediaFileHandler serves a local MediaFile by its database id over HTTP,
// honoring Range requests. This is intended for remote playback (e.g. a
// phone on the LAN opening the URL in VLC / Infuse / nPlayer).
//
// URL shape:
//
//	/file/<mediaFileId>
//	/file/<mediaFileId>/<optional-display-name.ext>
//
// The optional trailing path component lets us give VLC / the OS a nice
// filename with the correct extension so it picks the right player without
// having to sniff the Content-Type. It is ignored server-side.
func mediaFileHandler(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/file/")
	if rest == "" {
		http.Error(w, "missing media file id", http.StatusBadRequest)
		return
	}

	// id is the first path segment; anything after is a cosmetic filename.
	idStr := rest
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		idStr = rest[:i]
	}

	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid media file id", http.StatusBadRequest)
		return
	}

	if db.DB == nil {
		http.Error(w, "database not initialized", http.StatusInternalServerError)
		return
	}

	mediaFile, err := models.MediaFiles(
		qm.Where("id = ?", id),
	).One(context.Background(), db.DB)
	if err != nil {
		log.Printf("mediaFileHandler: media file %d not found: %v", id, err)
		http.Error(w, "media file not found", http.StatusNotFound)
		return
	}

	if !mediaFile.Path.Valid || mediaFile.Path.String == "" {
		http.Error(w, "media file has no path", http.StatusNotFound)
		return
	}
	path := mediaFile.Path.String

	// Hint the browser / player to treat this as a streamable media file
	// rather than an inline page. We set Content-Type from the extension
	// when possible; http.ServeFile will otherwise sniff the first 512
	// bytes which is usually fine but less predictable for .mkv.
	ext := strings.ToLower(filepath.Ext(path))
	if ct := contentTypeForExt(ext); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Accept-Ranges", "bytes")
	// Allow cross-origin requests so an HTML5 <video> element served from
	// a different host (dev setups) can still fetch the bytes.
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// http.ServeFile transparently handles Range requests, If-Modified-Since,
	// ETag, and 206 Partial Content responses.
	http.ServeFile(w, r, path)
}

// contentTypeForExt returns a best-effort MIME type for common video/audio
// containers. Falls back to mime.TypeByExtension for anything else.
func contentTypeForExt(ext string) string {
	switch ext {
	case ".mkv":
		return "video/x-matroska"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".avi":
		return "video/x-msvideo"
	case ".mov":
		return "video/quicktime"
	case ".ts":
		return "video/mp2t"
	case ".flv":
		return "video/x-flv"
	case ".wmv":
		return "video/x-ms-wmv"
	}
	return mime.TypeByExtension(ext)
}
