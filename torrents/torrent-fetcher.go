package torrents

import (
	"context"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	m "go-poc/models"
	tmdb2 "go-poc/tmdb"
	"go-poc/torrents/tpb"
	"time"
)

type TorrentFetcher struct {
	pirateBayLink string
	tmdbClient    *tmdb.Client
}

func NewTorrentFetcher(link string, tmdbClient *tmdb.Client) *TorrentFetcher {
	return &TorrentFetcher{
		pirateBayLink: link,
		tmdbClient:    tmdbClient,
	}
}

func (tf *TorrentFetcher) Fetch() {
	// Fetch the torrent from the pirate bay link
	tf.GetTorrents()

	// Get metadata from the internet
	tf.GetMetaDataFromInternet()
}

func (tf *TorrentFetcher) GetMetaDataFromInternet() {
	// get all missing metadata for files and query TMDB
	torrentsWithoutMetaData, err := m.TorrentFiles(qm.Where(`metaDataId IS NULL`)).AllG(context.Background())
	if err != nil {
		fmt.Println("no torrents without metadata found, skipping")
		return
	}

	tmdbClient := tf.tmdbClient
	for _, file := range torrentsWithoutMetaData {
		tor, err := ptn.Parse(file.Raw.String)
		if tmdb2.HandleMetaDataGettingErr2(*file, err) {
			continue
		}

		// try getting metadata from DB
		var md = &m.MetaDatum{}
		if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
			md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).OneG(context.Background())
			if tmdb2.HandleMetaDataGettingErr2(*file, err) {
				continue
			}
		} else {
			newMd, err := tmdb2.GetMediaFromTMDB(tmdbClient, *tor)
			if tmdb2.HandleMetaDataGettingErr2(*file, err) {
				continue
			}

			// check if newMd is already saved
			if !newMd.ID.Valid {
				// save the metadata to the db
				fmt.Println("inserting metadata to DB")
				err = newMd.InsertG(context.Background(), boil.Infer())
				if tmdb2.HandleMetaDataGettingErr2(*file, err) {
					continue
				}
			}
			md = newMd
		}

		// if it's a series get the episode
		if md.Series.Valid && md.Series.Bool {

			// try getting episode from DB
			fmt.Println("Getting episode metadata")
			epMd, err := tmdb2.GetEpisodeFromTMDB(tmdbClient, *tor, md)
			if tmdb2.HandleMetaDataGettingErr2(*file, err) {
				continue
			}

			if !epMd.ID.Valid {
				// save the episode metadata to the db
				fmt.Println("inserting episode to DB")
				err = epMd.InsertG(context.Background(), boil.Infer())
				if tmdb2.HandleMetaDataGettingErr2(*file, err) {
					continue
				}
			}

			file.EpisodeId = epMd.ID
		}

		// update file foreignKey in db row
		file.MetaDataId = md.ID
		file.Status = null.StringFrom("scanned")
		_, _ = file.UpdateG(context.Background(), boil.Infer())
	}
}

func (tf *TorrentFetcher) GetTorrents() {
	listOfSearches := []string{
		"top100:48h_211", // movies trending in the last 48 hours 2160p
		"top100:48h_212", // series trending in the last 48 hours 2160p
		"top100:48h_207", // movies trending in the last 48 hours 1080p
		"top100:48h_208", // series trending in the last 48 hours 1080p
	}
	for _, search := range listOfSearches {
		fetchTorrentsFromSearch(search)
	}
}

func fetchTorrentsFromSearch(search string) {
	// Fetch the torrent from the pirate bay link
	torrents, err := tpb.Lookup(search, time.Second*30)
	if err != nil {
		fmt.Println("Error fetching torrents: ", err)
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
		}
		err = dbTor.InsertG(context.Background(), boil.Infer())
		if err != nil {
			continue
		}
	}
}
