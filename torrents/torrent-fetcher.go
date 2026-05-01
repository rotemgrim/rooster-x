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
	pirateBayLink string
	tmdbClient    *tmdb.Client
	server        *server.Server
}

func NewTorrentFetcher(link string, s *server.Server, tmdbClient *tmdb.Client) *TorrentFetcher {
	return &TorrentFetcher{
		pirateBayLink: link,
		server:        s,
		tmdbClient:    tmdbClient,
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

		uploadedAt := parseUploadDate(torrent.UplDate)

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
			UploadedAt: null.TimeFrom(uploadedAt),
			SeenAt:     null.Int64From(time.Now().Unix()),
		}
		ctx := context.Background()
		err = dbTor.Insert(ctx, db.DB, boil.Infer())
		if err != nil {
			log.Printf("skipping (%s) magnet=%s: %s", tor.Title, magnetInfohashPrefix(torrent.Magnet), err)
			continue
		}
		log.Println("Adding to DB: ", tor.Title)
	}
}

// parseUploadDate handles various date formats from TPB sites:
// - "2006-01-02 15:04:05" (original site)
// - "Today 09:35" or "Today&nbsp;09:35" (proxy site)
// - "Y-day 16:20" or "Y-day&nbsp;16:20" (proxy site)
// - "01-25 14:30" (month-day format, proxy site)
func parseUploadDate(dateStr string) time.Time {
	// Normalize: replace &nbsp; with space
	dateStr = strings.ReplaceAll(dateStr, "\u00a0", " ")
	dateStr = strings.ReplaceAll(dateStr, "&nbsp;", " ")
	dateStr = strings.TrimSpace(dateStr)

	now := time.Now()

	// Try original format first: "2006-01-02 15:04:05"
	if t, err := time.Parse("2006-01-02 15:04:05", dateStr); err == nil {
		return t
	}

	// Handle "Today HH:MM"
	if strings.HasPrefix(dateStr, "Today") {
		timeStr := strings.TrimPrefix(dateStr, "Today")
		timeStr = strings.TrimSpace(timeStr)
		if t, err := time.Parse("15:04", timeStr); err == nil {
			return time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
		}
	}

	// Handle "Y-day HH:MM" (yesterday)
	if strings.HasPrefix(dateStr, "Y-day") {
		timeStr := strings.TrimPrefix(dateStr, "Y-day")
		timeStr = strings.TrimSpace(timeStr)
		if t, err := time.Parse("15:04", timeStr); err == nil {
			yesterday := now.AddDate(0, 0, -1)
			return time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
		}
	}

	// Handle "MM-DD HH:MM" format (assumes current year)
	if t, err := time.Parse("01-02 15:04", dateStr); err == nil {
		return time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
	}

	// Fallback to now
	return now
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
