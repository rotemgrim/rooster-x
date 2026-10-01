package engine

import (
	"context"
	"encoding/hex"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent/tracker"
	"github.com/anacrolix/torrent/types/infohash"
)

// scrapeTrackers are asked in parallel; each only sees part of a swarm, so
// the highest count per torrent is kept.
var scrapeTrackers = []string{
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
}

const (
	scrapeTimeout = 3 * time.Second
	// UDP trackers answer at most ~74 info hashes per scrape packet.
	scrapeBatch = 70
)

type PeerCounts struct {
	Seeders  int64
	Leechers int64
}

// Scrape asks the trackers for seeder/leecher counts of the given info
// hashes (hex). Hashes no tracker answered for are missing from the result.
func Scrape(hashes []string) map[string]PeerCounts {
	var ihs []infohash.T
	for _, h := range hashes {
		b, err := hex.DecodeString(h)
		if err != nil || len(b) != 20 {
			continue
		}
		var ih infohash.T
		copy(ih[:], b)
		ihs = append(ihs, ih)
	}

	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out = map[string]PeerCounts{}
	)
	for _, tr := range scrapeTrackers {
		for start := 0; start < len(ihs); start += scrapeBatch {
			batch := ihs[start:min(start+scrapeBatch, len(ihs))]
			wg.Add(1)
			go func(tr string, batch []infohash.T) {
				defer wg.Done()
				res, err := scrapeOne(tr, batch)
				if err != nil {
					log.Printf("scrape %s failed: %v", tr, err)
					return
				}
				mu.Lock()
				defer mu.Unlock()
				for i, r := range res {
					if i >= len(batch) {
						break
					}
					key := strings.ToUpper(hex.EncodeToString(batch[i][:]))
					cur := out[key]
					out[key] = PeerCounts{
						Seeders:  max(cur.Seeders, r.Seeders),
						Leechers: max(cur.Leechers, r.Leechers),
					}
				}
			}(tr, batch)
		}
	}
	wg.Wait()
	return out
}

func scrapeOne(tr string, ihs []infohash.T) ([]PeerCounts, error) {
	c, err := tracker.NewClient(tr, tracker.NewClientOpts{})
	if err != nil {
		return nil, err
	}
	defer c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), scrapeTimeout)
	defer cancel()
	res, err := c.Scrape(ctx, ihs)
	if err != nil {
		return nil, err
	}
	out := make([]PeerCounts, len(res))
	for i, r := range res {
		out[i] = PeerCounts{Seeders: int64(r.Seeders), Leechers: int64(r.Leechers)}
	}
	return out, nil
}
