package engine

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPieceReaderReadsAndSeeks(t *testing.T) {
	startOffline(t)
	hash, tt := addFinished(t, "movie.mkv")
	st, err := ses.Status(hash, false)
	if err != nil {
		t.Fatal(err)
	}
	f := st.Files[0]
	r := &pieceReader{ctx: context.Background(), hash: hash, offset: f.Offset, size: f.Size, pieceLen: st.PieceLength, piece: -1}

	all, err := io.ReadAll(r)
	if err != nil || !bytes.Equal(all, tt.Data) {
		t.Fatalf("read %d bytes, err %v; want all %d bytes", len(all), err, len(tt.Data))
	}
	// across a piece boundary
	from := int64(len(tt.Data)/3 - 10)
	if _, err := r.Seek(from, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 20)
	if _, err := io.ReadFull(r, buf); err != nil || !bytes.Equal(buf, tt.Data[from:from+20]) {
		t.Errorf("after seek: %v, err %v", buf, err)
	}
}

func TestStreamHandlerServesRanges(t *testing.T) {
	startOffline(t)
	hash, tt := addFinished(t, "movie.mkv")
	req := httptest.NewRequest(http.MethodGet, "/engine/stream/"+hash+"/0/movie.mkv", nil)
	req.Header.Set("Range", "bytes=100-199")
	rec := httptest.NewRecorder()
	StreamHandler("/engine/stream/")(rec, req)

	if rec.Code != http.StatusPartialContent || !bytes.Equal(rec.Body.Bytes(), tt.Data[100:200]) {
		t.Errorf("status %d, %d bytes; want 206 with bytes 100-199", rec.Code, rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	StreamHandler("/engine/stream/")(rec, httptest.NewRequest(http.MethodGet, "/engine/stream/"+hash+"/5", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing file index: status %d, want 404", rec.Code)
	}
}
