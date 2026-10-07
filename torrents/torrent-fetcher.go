package torrents

import (
	"context"
	"go-poc/db"
	EventBus "go-poc/event-bus"
	m "go-poc/models"
	"go-poc/ptnutil"
	"go-poc/server"
	gtmdb "go-poc/tmdb"
	"go-poc/torrents/tpb"
	"log"
	"strings"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

type TorrentFetcher struct {
	tmdbClient *tmdb.Client
	server     *server.Server
}

func NewTorrentFetcher(s *server.Server, tmdbClient *tmdb.Client) *TorrentFetcher {
	return &TorrentFetcher{
		server:     s,
		tmdbClient: tmdbClient,
	}
}

func (tf *TorrentFetcher) FullSweep() {
	// Fetch the torrent from the pirate bay link
	tf.GetTorrents()
}

func (tf *TorrentFetcher) GetMetaDataFromInternet() {
	ctx := context.Background()
	// get all missing metadata for files and query TMDB
	torrentsWithoutMetaData, err := m.TorrentFiles(qm.Where(`metaDataId IS NULL`)).All(ctx, db.DB)
	if err != nil {
		log.Println("no torrents without metadata found, skipping")
		return
	}

	tmdbClient := tf.tmdbClient
	totalFiles := len(torrentsWithoutMetaData)
	for i, file := range torrentsWithoutMetaData {
		gtmdb.GetMetaDataAndSaveToDB2(file, tmdbClient, tf.server, i, totalFiles)
	}
}

func (tf *TorrentFetcher) GetTorrents() {
	log.Println("started fetching torrents")

	tf.server.BroadcastMessage("Fetching torrents from pirate bay, Please wait...")

	fetchTorrentsFromSearch()

	// Get metadata from the internet
	tf.GetMetaDataFromInternet()

	tf.server.BroadcastMessage("Finished fetching torrents and metadata :)")

	// Refresh materialised feed snapshots so the next GetMedia request hits
	// fresh aggregates without paying the GROUP BY cost on the read path.
	// Must run BEFORE reload broadcast so the browser re-fetches against the
	// new feed tables instead of the stale pre-sweep snapshot.
	db.RebuildFeeds()

	tf.server.BroadcastMessage("reload-torrents")
	EventBus.SendEvent("sweep-done", nil)
}

func fetchTorrentsFromSearch() {

	// Fetch the torrent from the pirate bay link
	torrents, err := tpb.Lookup(time.Second * 30)
	if err != nil {
		log.Println("Error fetching torrents: ", err)
		return
	}

	for _, torrent := range torrents {
		tor, err := ptnutil.SafeParse(torrent.Name)
		if err != nil {
			continue
		}

		// Extract the btih infohash from the magnet. The infohash is the
		// stable identity of a torrent — the surrounding magnet URI varies
		// between TPB proxies (different tracker lists, different `dn=`
		// URL encoding), so the table's UNIQUE(magnet) constraint does NOT
		// catch cross-proxy duplicates. Dedupe by infohash instead.
		infoHash := extractInfoHash(torrent.Magnet)
		if infoHash != "" {
			var existingID int64
			err := db.DB.QueryRow(
				`SELECT id FROM torrentFile WHERE infoHash = ? LIMIT 1`,
				infoHash,
			).Scan(&existingID)
			if err == nil {
				// Already have this torrent. Refresh its peer counts from
				// apibay only if the stored ones are older than the max age.
				if _, err := db.DB.Exec(
					`UPDATE torrentFile SET seeders = ?, leechers = ?, peersUpdatedAt = ?
					 WHERE id = ? AND (peersUpdatedAt IS NULL OR peersUpdatedAt < ?)`,
					torrent.Seeders, torrent.Leechers, time.Now().Unix(),
					existingID, time.Now().Add(-db.PeerCountsMaxAge).Unix(),
				); err != nil {
					log.Printf("could not refresh peer counts on torrent id=%d: %s", existingID, err)
				}
				continue
			}
		}

		// episodeId is the FK to episode(id), populated by the TMDB
		// enrichment step that runs right after this insert. The parser's
		// tor.Episode is just the episode *number* from the filename, not
		// an episode-table id, so we can't use it here without violating
		// the FK (or, worse, attaching the torrent to the wrong episode
		// when the number coincidentally matches some unrelated id).
		// save the torrent to the database
		dbTor := &m.TorrentFile{
			Raw:        null.StringFrom(torrent.Name),
			Title:      null.StringFrom(tor.Title),
			Magnet:     null.StringFrom(torrent.Magnet),
			EpisodeId:  null.Int64{},
			Year:       null.Int64From(int64(tor.Year)),
			Resolution: null.StringFrom(tor.Resolution),
			Quality:    null.StringFrom(tor.Quality),
			Codec:      null.StringFrom(tor.Codec),
			Audio:      null.StringFrom(tor.Audio),
			Group:      null.StringFrom(tor.Group),
			Region:     null.StringFrom(tor.Region),
			Language:   null.StringFrom(tor.Language),
			Extended:   null.BoolFrom(tor.Extended),
			Hardcoded:  null.BoolFrom(tor.Hardcoded),
			Proper:     null.BoolFrom(tor.Proper),
			Repack:     null.BoolFrom(tor.Repack),
			WideScreen: null.BoolFrom(tor.Widescreen),
			UploadedAt: null.TimeFrom(torrent.Uploaded),
			SeenAt:     null.Int64From(time.Now().Unix()),
		}
		ctx := context.Background()
		err = dbTor.Insert(ctx, db.DB, boil.Infer())
		if err != nil {
			log.Printf("skipping (%s) magnet=%s: %s", tor.Title, magnetInfohashPrefix(torrent.Magnet), err)
			continue
		}

		// Stamp infoHash, imdbId and apibay's peer counts on the row we just
		// inserted. The sqlboiler model doesn't know about these columns
		// (they predate the migrations), so we set them via raw SQL. The
		// UNIQUE index on infoHash now backstops the SELECT-then-INSERT
		// check above against concurrent sweeps.
		if dbTor.ID.Valid {
			if _, err := db.DB.Exec(
				`UPDATE torrentFile SET infoHash = NULLIF(?, ''), imdbId = NULLIF(?, ''),
				 seeders = ?, leechers = ?, peersUpdatedAt = ? WHERE id = ?`,
				infoHash, torrent.ImdbId, torrent.Seeders, torrent.Leechers, time.Now().Unix(), dbTor.ID.Int64,
			); err != nil {
				log.Printf("could not stamp infoHash/imdbId/peers on torrent id=%d: %s", dbTor.ID.Int64, err)
			}
		}

		log.Println("Adding to DB: ", tor.Title)
	}
}

// extractInfoHash pulls the btih hash out of a magnet URI. Returns the
// hash uppercased (so it dedupes case-insensitively against the DB
// column, which is COLLATE NOCASE anyway) or "" if the magnet doesn't
// carry an xt=urn:btih: parameter.
//
// We don't decode the magnet — we just locate "xt=urn:btih:" and read
// everything up to the next "&". That covers both the 40-char hex SHA1
// form (the common case from TPB) and the 32-char base32 form.
func extractInfoHash(magnet string) string {
	const marker = "xt=urn:btih:"
	i := strings.Index(magnet, marker)
	if i < 0 {
		return ""
	}
	rest := magnet[i+len(marker):]
	if amp := strings.Index(rest, "&"); amp >= 0 {
		rest = rest[:amp]
	}
	return strings.ToUpper(strings.TrimSpace(rest))
}

func magnetInfohashPrefix(magnet string) string {
	idx := -1
	colonCount := 0
	for i := 0; i < len(magnet); i++ {
		if magnet[i] == ':' {
			colonCount++
			if colonCount == 3 {
				idx = i
				break
			}
		}
	}
	if idx == -1 || idx+1 >= len(magnet) {
		return "n/a"
	}
	rest := magnet[idx+1:]
	if len(rest) > 6 {
		rest = rest[:6]
	}
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "n/a"
	}
	return rest
}

func getTitle(md *m.MetaDatum, tor *ptn.TorrentInfo, file *m.TorrentFile) string {
	if md.Title.Valid {
		return md.Title.String
	} else if tor.Title != "" {
		return tor.Title
	} else if file.Raw.Valid {
		return file.Raw.String
	}
	return "unknown"
}
