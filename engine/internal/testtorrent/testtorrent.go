// Package testtorrent writes small single-file torrents for tests, so a
// torrent can be complete without any network.
package testtorrent

import (
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

const PieceLength = 16 << 10

// Torrent is a file in a download folder plus its .torrent.
type Torrent struct {
	Data        []byte
	DataPath    string // dir/name
	TorrentPath string
	Hash        string // v1 info hash, lowercase hex
	Magnet      string
}

// Write creates dir/name with size random bytes and a .torrent for it in a
// separate temp dir.
func Write(t *testing.T, dir, name string, size int) Torrent {
	t.Helper()
	data := make([]byte, size)
	_, _ = rand.Read(data)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	var pieces bytes.Buffer
	for off := 0; off < size; off += PieceLength {
		sum := sha1.Sum(data[off:min(off+PieceLength, size)])
		pieces.Write(sum[:])
	}
	info := bencode(map[string]any{
		"length":       size,
		"name":         name,
		"piece length": PieceLength,
		"pieces":       pieces.String(),
	})
	hash := sha1.Sum(info)
	torrentPath := filepath.Join(t.TempDir(), name+".torrent")
	if err := os.WriteFile(torrentPath, append(append([]byte("d4:info"), info...), 'e'), 0644); err != nil {
		t.Fatal(err)
	}
	hexHash := fmt.Sprintf("%x", hash)
	return Torrent{
		Data:        data,
		DataPath:    path,
		TorrentPath: torrentPath,
		Hash:        hexHash,
		Magnet:      "magnet:?xt=urn:btih:" + hexHash + "&dn=" + name,
	}
}

func bencode(v any) []byte {
	var b bytes.Buffer
	switch v := v.(type) {
	case int:
		fmt.Fprintf(&b, "i%de", v)
	case string:
		fmt.Fprintf(&b, "%d:%s", len(v), v)
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('d')
		for _, k := range keys {
			b.Write(bencode(k))
			b.Write(bencode(v[k]))
		}
		b.WriteByte('e')
	default:
		panic(fmt.Sprintf("bencode: unsupported %T", v))
	}
	return b.Bytes()
}
