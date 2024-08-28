package torrents

import (
	"context"
	"fmt"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"go-poc/models"
	"go-poc/torrents/tpb"
	"time"
)

type TorrentFetcher struct {
	pirateBayLink string
}

func NewTorrentFetcher(link string) *TorrentFetcher {
	return &TorrentFetcher{pirateBayLink: link}
}

func (tf *TorrentFetcher) Fetch() {
	// Fetch the torrent from the pirate bay link
	torrents, err := tpb.Lookup("top100:48h_211", time.Second*30)
	if err != nil {
		fmt.Println("Error fetching torrents: ", err)
		return
	}

	for _, torrent := range torrents {
		tor, err := ptn.Parse(torrent.Name)
		if err != nil {
			continue
		}

		timeTemplate := "2006-01-02"
		uploadedAt, err := time.Parse(timeTemplate, torrent.UplDate)
		if err != nil {
			uploadedAt = time.Now()
		}

		// save the torrent to the database
		dbTor := &models.TorrentFile{
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
			UploadedAt: null.Int64From(uploadedAt.Unix()),
		}
		err = dbTor.InsertG(context.Background(), boil.Infer())
		if err != nil {
			continue
		}
	}
}
