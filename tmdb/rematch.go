package gtmdb

import (
	"context"
	"fmt"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/ptnutil"
	"log"
	"strings"

	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

// RematchTorrent links a torrent that was matched to the wrong title to another
// one: it searches TMDB again by the torrent's name, without the IMDb id it came
// with and without the title it has now. With chosen (a TMDB id) it links the
// torrent to that title instead of searching. When there is no other title the
// torrent keeps the one it has.
//
// The torrents with the same parsed name on the same wrong title (other
// episodes and releases of it) were matched wrong the same way, so they move to
// the new title too. It returns the new title and how many torrents moved.
func RematchTorrent(torrentId, chosen int64) (title string, moved int, err error) {
	if enrichmentClient == nil {
		return "", 0, fmt.Errorf("tmdb client not initialized")
	}
	ctx := context.Background()
	file, err := m.TorrentFiles(qm.Where("id = ?", torrentId)).One(ctx, db.DB)
	if err != nil {
		return "", 0, fmt.Errorf("torrent %d not found: %w", torrentId, err)
	}

	tor, err := ptnutil.SafeParse(file.Raw.String)
	if err != nil {
		return "", 0, err
	}

	oldMetaId := file.MetaDataId.Int64
	var exclude int64
	if oldMetaId != 0 {
		// a title of the other kind is not the one a search could find again:
		// the series with its TMDB id is another title
		if old, err := m.MetaData(qm.Where("id = ?", oldMetaId)).One(ctx, db.DB); err == nil && old.Series.Bool == isSeriesTorrent(*tor) {
			exclude = old.TMDBID.Int64
		}
	}
	if chosen != 0 && chosen == exclude {
		return "", 0, fmt.Errorf("the torrent already has this title")
	}

	oldEpisodes := []int64{file.EpisodeId.Int64}
	if err := relink(file, exclude, chosen); err != nil {
		return "", 0, fmt.Errorf("could not link %s to another title: %w", file.Raw.String, err)
	}
	moved = 1
	md, err := m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).One(ctx, db.DB)
	if err != nil {
		return "", 0, fmt.Errorf("could not load the new title: %w", err)
	}

	if oldMetaId != 0 && file.Title.String != "" {
		siblings, err := m.TorrentFiles(
			qm.Where("metaDataId = ?", oldMetaId),
			qm.Where("id != ?", file.ID),
			qm.Where("title = ? COLLATE NOCASE", file.Title.String),
		).All(ctx, db.DB)
		if err != nil {
			log.Printf("could not load the torrents named like %s: %v", file.Title.String, err)
		}
		// one at a time: two releases of one episode would both save the episode at once
		for i, sib := range siblings {
			broadcast(fmt.Sprintf("Moving torrents named %s to %s [%d/%d]", file.Title.String, md.Title.String, i+1, len(siblings)))
			episodeId := sib.EpisodeId.Int64
			// the title is known now, so the siblings need no search
			if err := relink(sib, exclude, md.TMDBID.Int64); err != nil {
				log.Printf("could not move %s to %s: %v", sib.Raw.String, md.Title.String, err)
				continue
			}
			oldEpisodes = append(oldEpisodes, episodeId)
			moved++
		}
	}

	db.DropUnused(oldMetaId, oldEpisodes)
	// the feeds list what the torrents are linked to
	go db.RebuildFeeds()
	return md.Title.String, moved, nil
}

// relink matches a torrent again, without the title exclude or to the title
// chosen (TMDB ids, 0 for none). When it cannot, the torrent keeps its links.
func relink(file *m.TorrentFile, exclude, chosen int64) error {
	oldMetaId, oldEpisodeId := file.MetaDataId, file.EpisodeId
	oldStatus, oldScanError := file.Status, file.ScanError

	// matching only searches TMDB for torrents that have no title
	file.MetaDataId, file.EpisodeId = null.Int64{}, null.Int64{}
	err := matchTorrent(file, enrichmentClient, func(string) {}, 1, 1, exclude, true, chosen)
	if err != nil {
		// matching saved its error on the torrent, so give it its old links back
		file.MetaDataId, file.EpisodeId = oldMetaId, oldEpisodeId
		file.Status, file.ScanError = oldStatus, oldScanError
		if _, uerr := file.Update(context.Background(), db.DB, boil.Infer()); uerr != nil {
			log.Printf("could not restore torrent %d: %v", file.ID.Int64, uerr)
		}
	}
	return err
}

// TitleChoice is a TMDB title a torrent can be linked to.
type TitleChoice struct {
	TmdbId        int64  `json:"tmdbId"`
	Title         string `json:"title"`
	OriginalTitle string `json:"originalTitle,omitempty"`
	Year          string `json:"year,omitempty"`
	Poster        string `json:"poster,omitempty"`
	Overview      string `json:"overview,omitempty"`
	// IsCurrent marks the title the torrent has now
	IsCurrent bool `json:"isCurrent"`
}

// TitleChoices are the titles a torrent can be linked to.
type TitleChoices struct {
	Choices []TitleChoice `json:"choices"`
	// Name is the torrent's parsed name, Siblings how many other torrents with
	// that name have the same title, which move along with it.
	Name     string `json:"name"`
	Siblings int    `json:"siblings"`
}

// maxTitleChoices caps how many titles SearchTitlesForTorrent offers.
const maxTitleChoices = 12

// SearchTitlesForTorrent searches TMDB for the titles a torrent can be linked
// to: series for a torrent of an episode, movies otherwise. query is what to
// search for, by default the torrent's parsed title.
func SearchTitlesForTorrent(torrentId int64, query string) (*TitleChoices, error) {
	if enrichmentClient == nil {
		return nil, fmt.Errorf("tmdb client not initialized")
	}
	ctx := context.Background()
	file, err := m.TorrentFiles(qm.Where("id = ?", torrentId)).One(ctx, db.DB)
	if err != nil {
		return nil, fmt.Errorf("torrent %d not found: %w", torrentId, err)
	}
	tor, err := ptnutil.SafeParse(file.Raw.String)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(query) == "" {
		query = tor.Title
	}

	var current int64
	siblings := 0
	if file.MetaDataId.Valid && file.MetaDataId.Int64 != 0 {
		// the choices are of the torrent's kind, so a title of the other kind
		// with the same TMDB id is none of them
		if md, err := m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).One(ctx, db.DB); err == nil && md.Series.Bool == isSeriesTorrent(*tor) {
			current = md.TMDBID.Int64
		}
		if file.Title.String != "" {
			n, err := m.TorrentFiles(
				qm.Where("metaDataId = ?", file.MetaDataId.Int64),
				qm.Where("id != ?", file.ID),
				qm.Where("title = ? COLLATE NOCASE", file.Title.String),
			).Count(ctx, db.DB)
			if err == nil {
				siblings = int(n)
			}
		}
	}

	options := map[string]string{"language": LANG}
	choices := []TitleChoice{}
	if isSeriesTorrent(*tor) {
		res, err := enrichmentClient.GetSearchTVShow(query, options)
		if err != nil {
			return nil, err
		}
		for _, r := range res.Results {
			choices = append(choices, TitleChoice{r.ID, r.Name, differentName(r.OriginalName, r.Name),
				yearOf(r.FirstAirDate), r.PosterPath, r.Overview, r.ID == current})
		}
	} else {
		res, err := enrichmentClient.GetSearchMovies(query, options)
		if err != nil {
			return nil, err
		}
		for _, r := range res.Results {
			choices = append(choices, TitleChoice{r.ID, r.Title, differentName(r.OriginalTitle, r.Title),
				yearOf(r.ReleaseDate), r.PosterPath, r.Overview, r.ID == current})
		}
	}
	if len(choices) > maxTitleChoices {
		choices = choices[:maxTitleChoices]
	}
	return &TitleChoices{choices, file.Title.String, siblings}, nil
}

// differentName returns the original name when it differs from the shown one.
func differentName(original, shown string) string {
	if original == shown {
		return ""
	}
	return original
}

// yearOf returns the year of a TMDB date like 2023-08-22.
func yearOf(date string) string {
	year, _, _ := strings.Cut(date, "-")
	return year
}
