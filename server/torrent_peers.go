package server

import (
	"log"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"

	"go-poc/db"
	"go-poc/engine"
	"go-poc/models"
)

// TorrentWithPeers adds the seeder/leecher columns, which the sqlboiler
// model predates, to a torrent row sent to the UI.
type TorrentWithPeers struct {
	*models.TorrentFile
	Seeders        null.Int64 `json:"seeders"`
	Leechers       null.Int64 `json:"leechers"`
	PeersUpdatedAt null.Int64 `json:"peersUpdatedAt"` // unix seconds
}

// scrape asks the trackers for peer counts; tests replace it.
var scrape = engine.Scrape

// withPeerCounts loads the stored peer counts for the torrents, and returns the
// ones whose counts are missing or older than db.PeerCountsMaxAge by info hash,
// for refreshPeerCounts.
func withPeerCounts(files []*models.TorrentFile) (out []TorrentWithPeers, stale map[string][]*TorrentWithPeers) {
	out = make([]TorrentWithPeers, len(files))
	byID := map[int64]*TorrentWithPeers{}
	ids := make([]interface{}, 0, len(files))
	for i, f := range files {
		out[i].TorrentFile = f
		if f.ID.Valid {
			byID[f.ID.Int64] = &out[i]
			ids = append(ids, f.ID.Int64)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}

	rows, err := db.DB.Query(
		`SELECT id, infoHash, seeders, leechers, peersUpdatedAt FROM torrentFile
		 WHERE id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, ids...)
	if err != nil {
		log.Println("could not load torrent peer counts:", err)
		return out, nil
	}
	defer rows.Close()
	cutoff := time.Now().Add(-db.PeerCountsMaxAge).Unix()
	stale = map[string][]*TorrentWithPeers{}
	for rows.Next() {
		var id int64
		var hash null.String
		var seeders, leechers, updated null.Int64
		if err := rows.Scan(&id, &hash, &seeders, &leechers, &updated); err != nil {
			log.Println("could not read torrent peer counts:", err)
			continue
		}
		t := byID[id]
		t.Seeders, t.Leechers, t.PeersUpdatedAt = seeders, leechers, updated
		if hash.Valid && (!updated.Valid || updated.Int64 < cutoff) {
			key := strings.ToUpper(hash.String)
			stale[key] = append(stale[key], t)
		}
	}
	return out, stale
}

// refreshPeerCounts asks the trackers for the stale torrents' counts in one
// batched scrape (which can take seconds), then saves and sets them.
func refreshPeerCounts(stale map[string][]*TorrentWithPeers) {
	hashes := make([]string, 0, len(stale))
	for h := range stale {
		hashes = append(hashes, h)
	}
	counts := scrape(hashes)
	now := time.Now().Unix()
	for hash, c := range counts {
		for _, t := range stale[hash] {
			if _, err := db.DB.Exec(
				`UPDATE torrentFile SET seeders = ?, leechers = ?, peersUpdatedAt = ? WHERE id = ?`,
				c.Seeders, c.Leechers, now, t.ID.Int64,
			); err != nil {
				log.Printf("could not save peer counts for torrent id=%d: %v", t.ID.Int64, err)
				continue
			}
			t.Seeders, t.Leechers, t.PeersUpdatedAt = null.Int64From(c.Seeders), null.Int64From(c.Leechers), null.Int64From(now)
		}
	}
	log.Printf("refreshed peer counts for %d of %d stale torrents", len(counts), len(stale))
}

// transmitWithPeerCounts answers req with what build makes of the torrents
// with their peer counts. When some counts are stale it first sends a chunk
// with the stored ones, so the UI shows them right away, and answers once the
// trackers have.
func transmitWithPeerCounts(c *websocket.Conn, req PayloadRequest, torrents []*models.TorrentFile,
	build func(withPeers []TorrentWithPeers) interface{}) {
	withPeers, stale := withPeerCounts(torrents)
	if len(stale) > 0 {
		if transmitPromiseChunk(c, req, build(withPeers)) != nil {
			return
		}
		refreshPeerCounts(stale)
	}
	transmitPromiseResponse(c, req, build(withPeers))
}
