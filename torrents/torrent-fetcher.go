package torrents

import (
	"context"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	EventBus "go-poc/event-bus"
	m "go-poc/models"
	"go-poc/server"
	gtmdb "go-poc/tmdb"
	"go-poc/torrents/tpb"
	"log"
	"time"
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
	// get all missing metadata for files and query TMDB
	torrentsWithoutMetaData, err := m.TorrentFiles(qm.Where(`metaDataId IS NULL`)).AllG(context.Background())
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
	listOfSearches := []string{
		"top100:48h_211", // movies trending in the last 48 hours 2160p
		"top100:48h_212", // series trending in the last 48 hours 2160p
		"top100:48h_207", // movies trending in the last 48 hours 1080p
		"top100:48h_208", // series trending in the last 48 hours 1080p
	}
	tf.server.BroadcastMessage("Fetching torrents from pirate bay, Please wait...")
	for i, search := range listOfSearches {
		msg := fmt.Sprintf("Fetching torrents from pirate bay [%d/%d] %s", i, len(listOfSearches), search)
		tf.server.BroadcastMessage(msg)
		fetchTorrentsFromSearch(search)
	}

	// Get metadata from the internet
	tf.GetMetaDataFromInternet()

	tf.server.BroadcastMessage("Finished fetching torrents and metadata :)")
	tf.server.BroadcastMessage("reload-torrents")
	EventBus.SendEvent("sweep-done", nil)
}

func fetchTorrentsFromSearch(search string) {
	// Fetch the torrent from the pirate bay link
	torrents, err := tpb.Lookup(search, time.Second*30)
	if err != nil {
		log.Println("Error fetching torrents: ", err)
		return
	}

	for _, torrent := range torrents {
		tor, err := ptn.Parse(torrent.Name)
		if err != nil {
			continue
		}

		timeTemplate := "2006-01-02 15:04:05"
		uploadedAt, err := time.Parse(timeTemplate, torrent.UplDate)
		if err != nil {
			uploadedAt = time.Now()
		}

		// save the torrent to the database
		dbTor := &m.TorrentFile{
			Raw:        null.StringFrom(torrent.Name),
			Title:      null.StringFrom(tor.Title),
			Magnet:     null.StringFrom(torrent.Magnet),
			EpisodeId:  null.Int64From(int64(tor.Episode)),
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
		err = dbTor.InsertG(context.Background(), boil.Infer())
		if err != nil {
			log.Printf("skipping (%s): %s", tor.Title, err)
			continue
		}
		log.Println("Adding to DB: ", tor.Title)
	}
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
