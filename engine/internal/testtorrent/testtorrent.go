// Package testtorrent writes small torrents for tests, so a torrent can be
// complete without any network.
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

// Torrent is a file (or a folder of them) in a download folder plus its
// .torrent.
type Torrent struct {
	Data        []byte // a multi-file torrent's files one after another
	DataPath    string // dir/name
	TorrentPath string
	Hash        string // v1 info hash, lowercase hex
	Magnet      string
}

// File is one file of a multi-file torrent.
type File struct {
	Name string
	Size int
}

// Write creates dir/name with size random bytes and a .torrent for it in a
// separate temp dir.
func Write(t *testing.T, dir, name string, size int) Torrent {
	t.Helper()
	data := randomFile(t, filepath.Join(dir, name), size)
	return writeTorrent(t, dir, name, data, map[string]any{"length": size})
}

// WriteFiles creates the files with random bytes in the folder dir/name and
// a .torrent for them in a separate temp dir.
func WriteFiles(t *testing.T, dir, name string, files []File) Torrent {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, name), 0755); err != nil {
		t.Fatal(err)
	}
	var data []byte
	var list []any
	for _, f := range files {
		data = append(data, randomFile(t, filepath.Join(dir, name, f.Name), f.Size)...)
		list = append(list, map[string]any{"length": f.Size, "path": []any{f.Name}})
	}
	return writeTorrent(t, dir, name, data, map[string]any{"files": list})
}

func randomFile(t *testing.T, path string, size int) []byte {
	t.Helper()
	data := make([]byte, size)
	_, _ = rand.Read(data)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	return data
}

// writeTorrent writes the .torrent for data, with info holding the file
// fields ("length" or "files").
func writeTorrent(t *testing.T, dir, name string, data []byte, info map[string]any) Torrent {
	t.Helper()
	var pieces bytes.Buffer
	for off := 0; off < len(data); off += PieceLength {
		sum := sha1.Sum(data[off:min(off+PieceLength, len(data))])
		pieces.Write(sum[:])
	}
	info["name"] = name
	info["piece length"] = PieceLength
	info["pieces"] = pieces.String()
	encoded := bencode(info)
	hash := sha1.Sum(encoded)
	torrentPath := filepath.Join(t.TempDir(), name+".torrent")
	if err := os.WriteFile(torrentPath, append(append([]byte("d4:info"), encoded...), 'e'), 0644); err != nil {
		t.Fatal(err)
	}
	hexHash := fmt.Sprintf("%x", hash)
	return Torrent{
		Data:        data,
		DataPath:    filepath.Join(dir, name),
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
	case []any:
		b.WriteByte('l')
		for _, x := range v {
			b.Write(bencode(x))
		}
		b.WriteByte('e')
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
