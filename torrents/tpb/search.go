package tpb

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Torrent contains meta information about the torrent
type Torrent struct {
	Magnet   string
	Name     string
	Size     int64 // bytes
	Uploaded time.Time
	Seeders  int
	Leechers int
	ImdbId   string // empty when apibay doesn't know it
}

// apibay.org is the JSON API behind thepiratebay.org's own front end.
const apibayUrl = "https://apibay.org/precompiled/data_top100_%s.json"

var top100Lists = []string{
	"48h_211", // movies trending in the last 48 hours 2160p
	"48h_212", // series trending in the last 48 hours 2160p
	"48h_207", // movies trending in the last 48 hours 1080p
	"48h_208", // series trending in the last 48 hours 1080p
}

// trackers are the ones thepiratebay.org appends when it builds a magnet link.
var trackers = []string{
	"udp://tracker.opentrackr.org:1337",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
	"udp://tracker.bittor.pw:1337/announce",
	"udp://public.popcorn-tracker.org:6969/announce",
	"udp://tracker.dler.org:6969/announce",
	"udp://exodus.desync.com:6969",
	"udp://open.demonii.com:1337/announce",
	"udp://glotorrents.pw:6969/announce",
	"udp://tracker.coppersurfer.tk:6969",
	"udp://torrent.gresille.org:80/announce",
	"udp://p4p.arenabg.com:1337",
	"udp://tracker.internetwarriors.net:1337",
}

type apibayTorrent struct {
	InfoHash string `json:"info_hash"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Seeders  int    `json:"seeders"`
	Leechers int    `json:"leechers"`
	Added    int64  `json:"added"`
	Imdb     string `json:"imdb"` // null or "" when unknown
}

// Lookup fetches the trending top-100 lists from apibay concurrently and
// returns the combined torrents. Lists that fail are logged and skipped.
func Lookup(timeout time.Duration) ([]Torrent, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		torrents []Torrent
	)
	for _, list := range top100Lists {
		wg.Add(1)
		go func(list string) {
			defer wg.Done()
			res, err := fetchList(ctx, list)
			if err != nil {
				log.Printf("could not fetch apibay list %s: %v", list, err)
				return
			}
			log.Printf("found %d torrents in apibay list %s", len(res), list)
			mu.Lock()
			torrents = append(torrents, res...)
			mu.Unlock()
		}(list)
	}
	wg.Wait()

	if len(torrents) == 0 {
		return nil, fmt.Errorf("no torrents returned from apibay")
	}
	return torrents, nil
}

func fetchList(ctx context.Context, list string) ([]Torrent, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(apibayUrl, list), nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}

	var items []apibayTorrent
	if err := json.NewDecoder(res.Body).Decode(&items); err != nil {
		return nil, err
	}

	torrents := make([]Torrent, 0, len(items))
	for _, it := range items {
		// apibay answers an empty list with a single all-zero placeholder
		if strings.Trim(it.InfoHash, "0") == "" {
			continue
		}
		name := strings.ReplaceAll(html.UnescapeString(it.Name), "\u00a0", " ")
		torrents = append(torrents, Torrent{
			Magnet:   buildMagnet(it.InfoHash, name),
			Name:     name,
			Size:     it.Size,
			Uploaded: time.Unix(it.Added, 0),
			Seeders:  it.Seeders,
			Leechers: it.Leechers,
			ImdbId:   it.Imdb,
		})
	}
	return torrents, nil
}

func buildMagnet(infoHash, name string) string {
	var b strings.Builder
	b.WriteString("magnet:?xt=urn:btih:")
	b.WriteString(infoHash)
	b.WriteString("&dn=")
	b.WriteString(url.QueryEscape(name))
	for _, tr := range trackers {
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(tr))
	}
	return b.String()
}
