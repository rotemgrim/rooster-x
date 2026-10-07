package server

import (
	"log"
	"strings"
	"time"

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

// withPeerCounts loads the stored peer counts for the torrents. Counts that
// are missing or older than db.PeerCountsMaxAge are refreshed from the
// trackers in one batched scrape and saved; fresher ones are left alone.
func withPeerCounts(files []*models.TorrentFile) []TorrentWithPeers {
	out := make([]TorrentWithPeers, len(files))
	if len(files) == 0 {
		return out
	}
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
		return out
	}

	rows, err := db.DB.Query(
		`SELECT id, infoHash, seeders, leechers, peersUpdatedAt FROM torrentFile
		 WHERE id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`, ids...)
	if err != nil {
		log.Println("could not load torrent peer counts:", err)
		return out
	}
	cutoff := time.Now().Add(-db.PeerCountsMaxAge).Unix()
	staleIDs := map[string][]int64{} // infoHash -> torrent ids
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
			staleIDs[key] = append(staleIDs[key], id)
		}
	}
	rows.Close()
	if len(staleIDs) == 0 {
		return out
	}

	hashes := make([]string, 0, len(staleIDs))
	for h := range staleIDs {
		hashes = append(hashes, h)
	}
	counts := engine.Scrape(hashes)
	now := time.Now().Unix()
	for hash, c := range counts {
		for _, id := range staleIDs[hash] {
			if _, err := db.DB.Exec(
				`UPDATE torrentFile SET seeders = ?, leechers = ?, peersUpdatedAt = ? WHERE id = ?`,
				c.Seeders, c.Leechers, now, id,
			); err != nil {
				log.Printf("could not save peer counts for torrent id=%d: %v", id, err)
				continue
			}
			t := byID[id]
			t.Seeders, t.Leechers, t.PeersUpdatedAt = null.Int64From(c.Seeders), null.Int64From(c.Leechers), null.Int64From(now)
		}
	}
	log.Printf("refreshed peer counts for %d of %d stale torrents", len(counts), len(staleIDs))
	return out
}
