package engine

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// readaheadBytes is how far past the play position pieces get deadlines,
// so they arrive in order just before the player needs them.
const readaheadBytes = 16 << 20

// StreamHandler serves a file from a torrent over HTTP with Range support
// while it is still downloading. Reads block until the requested pieces
// arrive; pieces at and just after the play position get deadlines, so a
// player can start (and seek) before the download finishes.
//
// URL shape: <prefix><infoHash>/<fileIndex>[/<display-name.ext>]
func StreamHandler(prefix string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, prefix), "/", 3)
		if len(parts) < 2 {
			http.Error(w, "expected /<infoHash>/<fileIndex>", http.StatusBadRequest)
			return
		}
		if ses == nil {
			http.Error(w, errNotRunning.Error(), http.StatusServiceUnavailable)
			return
		}
		hash := strings.ToLower(parts[0])
		idx, err := strconv.Atoi(parts[1])
		if err != nil {
			http.Error(w, "invalid file index", http.StatusBadRequest)
			return
		}

		// a magnet only knows its files once the metadata arrives
		for {
			st, err := ses.Status(hash, false)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			if st.HasMetadata {
				for _, f := range st.Files {
					if f.Index == idx {
						rd := &pieceReader{ctx: r.Context(), hash: hash, offset: f.Offset, size: f.Size, pieceLen: st.PieceLength, piece: -1}
						w.Header().Set("Access-Control-Allow-Origin", "*")
						// ServeContent handles Range / 206 and sets Content-Type from the name.
						http.ServeContent(w, r, strings.TrimSuffix(f.Path, partSuffix), time.Time{}, rd)
						return
					}
				}
				http.Error(w, "file index out of range", http.StatusNotFound)
				return
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
}

// pieceReader reads one file of a torrent through libtorrent, piece by
// piece, waiting for pieces that haven't arrived yet.
type pieceReader struct {
	ctx      context.Context
	hash     string
	offset   int64 // of the file within the torrent
	size     int64
	pieceLen int64
	pos      int64 // within the file

	piece int // cached in buf[:n], -1 for none
	buf   []byte
	n     int
}

func (r *pieceReader) Read(p []byte) (int, error) {
	if r.pos >= r.size {
		return 0, io.EOF
	}
	abs := r.offset + r.pos
	piece := int(abs / r.pieceLen)
	if piece != r.piece {
		if r.buf == nil {
			r.buf = make([]byte, r.pieceLen)
		}
		ahead := int(max(readaheadBytes/r.pieceLen, 2))
		_ = ses.SetDeadlines(r.hash, piece+1, ahead, 1000)
		n, err := ses.ReadPiece(r.ctx, r.hash, piece, r.buf)
		if err != nil {
			r.piece = -1
			return 0, err
		}
		r.piece, r.n = piece, n
	}
	start := int(abs - int64(piece)*r.pieceLen)
	end := min(r.n, start+int(r.size-r.pos))
	if start >= end {
		return 0, io.ErrUnexpectedEOF
	}
	n := copy(p, r.buf[start:end])
	r.pos += int64(n)
	return n, nil
}

func (r *pieceReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		offset += r.pos
	case io.SeekEnd:
		offset += r.size
	default:
		return 0, errors.New("invalid whence")
	}
	if offset < 0 {
		return 0, errors.New("negative position")
	}
	r.pos = offset
	return offset, nil
}
