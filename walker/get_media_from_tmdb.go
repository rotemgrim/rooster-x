package walker

import (
	"context"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	m "go-poc/models"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func GetMediaFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo) (*m.MetaDatum, error) {

	// get metadata from internet
	var newMd = &m.MetaDatum{}
	var err = error(nil)
	if tor.Episode > 0 && tor.Season > 0 {
		err = getSeriesMetaData(newMd, tmdbClient, tor)
	} else {
		err = getMovieMetaData(newMd, tmdbClient, tor)
	}
	if err != nil {
		return nil, err
	}
	return newMd, nil
}

func GetEpisodeFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, md *m.MetaDatum) (*m.Episode, error) {
	// get metadata from internet
	var epMd = &m.Episode{}
	detailsOptions := map[string]string{
		"append_to_response": "external_ids",
	}
	epDetail, err := tmdbClient.GetTVEpisodeDetails(int(md.TMDBID.Int64), tor.Season, tor.Episode, detailsOptions)
	if err != nil {
		return nil, err
	}
	epMd.MetaDataId = md.ID
	epMd.Title = null.StringFrom(epDetail.Name)
	epMd.Plot = null.StringFrom(epDetail.Overview)
	epMd.ImdbId = null.StringFrom(epDetail.ExternalIDs.IMDbID)
	epMd.TMDBID = null.Int64From(epDetail.ID)
	epMd.ImdbSeriesId = md.ImdbId
	epMd.TmdbSeriesId = md.TMDBID
	epMd.Season = null.Int64From(int64(epDetail.SeasonNumber))
	epMd.Episode = null.Int64From(int64(epDetail.EpisodeNumber))
	epMd.Poster = null.StringFrom(epDetail.StillPath)
	epMd.Runtime = null.Int64From(int64(epDetail.Runtime))
	epMd.Released = null.StringFrom(epDetail.AirDate)
	// convert date string like 2023-08-22 to unix timestamp
	layout := "2006-01-02"
	t, err := time.Parse(layout, epDetail.AirDate)
	if err == nil {
		epMd.ReleasedUnix = null.Int64From(t.Unix())
	}
	return epMd, nil
}

func getSeriesMetaData(newMd *m.MetaDatum, tmdbClient *tmdb.Client, tor ptn.TorrentInfo) error {
	tmdbMetaData, err := tmdbClient.GetSearchTVShow(tor.Title, nil)
	if err != nil {
		return err
	}
	detailsOptions := map[string]string{
		"append_to_response": "external_ids,genres,episodes,credits",
	}
	tmdbDetails, err := tmdbClient.GetTVDetails(int(tmdbMetaData.Results[0].ID), detailsOptions)
	if err != nil {
		return err
	}

	newMd.Title = null.StringFrom(tmdbDetails.Name)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("series")
	newMd.Status = null.StringFrom("scanned")
	var genresArr []string
	for _, genre := range tmdbDetails.Genres {
		genresArr = append(genresArr, genre.Name)
	}
	newMd.Genres = null.StringFrom(strings.Join(genresArr, ","))
	newMd.ImdbId = null.StringFrom(tmdbDetails.TVExternalIDs.IMDbID)
	newMd.TMDBID = null.Int64From(tmdbDetails.ID)
	newMd.Series = null.BoolFrom(true)

	year, _ := strconv.ParseInt(strings.Split(tmdbDetails.FirstAirDate, "-")[0], 10, 64)
	newMd.Year = null.Int64From(year)
	newMd.Plot = null.StringFrom(tmdbDetails.Overview)
	newMd.Director = null.StringFrom(tmdbDetails.CreatedBy[0].Name)
	newMd.Released = null.StringFrom(tmdbDetails.FirstAirDate)

	// convert date string like 2023-08-22 to unix timestamp
	layout := "2006-01-02"
	t, err := time.Parse(layout, tmdbDetails.FirstAirDate)
	if err == nil {
		newMd.ReleasedUnix = null.Int64From(t.Unix())
	}

	var actors []string
	for _, actor := range tmdbDetails.Credits.Cast {
		actors = append(actors, actor.Name)
	}
	newMd.Actors = null.StringFrom(strings.Join(actors, ","))

	var countries []string
	for _, country := range tmdbDetails.OriginCountry {
		countries = append(countries, country)
	}
	newMd.Country = null.StringFrom(strings.Join(countries, ","))

	return nil

}

func getMovieMetaData(newMd *m.MetaDatum, tmdbClient *tmdb.Client, tor ptn.TorrentInfo) error {
	metaData, err := tmdbClient.GetSearchMovies(tor.Title, nil)
	if err != nil {
		return err
	}
	detailsOptions := map[string]string{
		"append_to_response": "external_ids,genres,credits,release_dates",
	}
	tmdbDetails, err := tmdbClient.GetMovieDetails(int(metaData.Results[0].ID), detailsOptions)
	if err != nil {
		return err
	}

	newMd.Title = null.StringFrom(tmdbDetails.Title)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("movie")
	newMd.Status = null.StringFrom("scanned")
	var genresArr []string
	for _, genre := range tmdbDetails.Genres {
		genresArr = append(genresArr, genre.Name)
	}
	newMd.Genres = null.StringFrom(strings.Join(genresArr, ","))
	newMd.ImdbId = null.StringFrom(tmdbDetails.IMDbID)
	newMd.TMDBID = null.Int64From(tmdbDetails.ID)
	newMd.Series = null.BoolFrom(false)
	year, _ := strconv.ParseInt(strings.Split(tmdbDetails.ReleaseDate, "-")[0], 10, 64)
	newMd.Year = null.Int64From(year)
	newMd.Plot = null.StringFrom(tmdbDetails.Overview)
	newMd.Runtime = null.Int64From(int64(tmdbDetails.Runtime))
	//newMd.Director = null.StringFrom(tmdbDetails.d)
	newMd.Released = null.StringFrom(tmdbDetails.ReleaseDate)

	// convert date string like 2023-08-22 to unix timestamp
	layout := "2006-01-02"
	t, err := time.Parse(layout, tmdbDetails.ReleaseDate)
	if err == nil {
		newMd.ReleasedUnix = null.Int64From(t.Unix())
	}
	var actors []string
	for _, actor := range tmdbDetails.Credits.Cast {
		actors = append(actors, actor.Name)
	}
	newMd.Actors = null.StringFrom(strings.Join(actors, ","))

	var countries []string
	for _, country := range tmdbDetails.OriginCountry {
		countries = append(countries, country)
	}
	newMd.Country = null.StringFrom(strings.Join(countries, ","))
	return nil
}

func GetSearchTVShow(
	query string,
	urlOptions map[string]string,
) (*TMDBSearchResult, error) {
	options := fmtOptions(urlOptions)
	// https://api.themoviedb.org/3/search/tv?api_key=REMOVED_TMDB_API_KEY&query=Snowpiercer&language=en-US&append_to_response=external_ids
	tmdbURL := fmt.Sprintf(
		"%s%s?api_key=%s&query=%s%s",
		"https://api.themoviedb.org/3/",
		"search/tv",
		"REMOVED_TMDB_API_KEY",
		url.QueryEscape(query),
		options,
	)
	searchTVShows := TMDBSearchResult{}
	if err := get(tmdbURL, &searchTVShows); err != nil {
		return nil, err
	}
	return &searchTVShows, nil
}

func handleMetaDataGettingErr(file m.MediaFile, err error) bool {
	if err != nil {
		fmt.Println("Error getting metadata from tmdb, %s", err)
		// update file row in db
		file.MetaDataId = null.Int64From(0)
		_, _ = file.UpdateG(context.Background(), boil.Infer())
		return true
	} else {
		return false
	}
}
