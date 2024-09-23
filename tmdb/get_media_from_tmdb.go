package gtmdb

import (
	"context"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/davecgh/go-spew/spew"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	m "go-poc/models"
	"go-poc/server"
	"log"
	"strconv"
	"strings"
	"time"
)

var TMDB_TV_SEARCH_CACHE = make(map[string]*tmdb.SearchTVShows)
var TMDB_MOVIE_SEARCH_CACHE = make(map[string]*tmdb.SearchMovies)
var LANG = "en-US"

//var LANG = "he-IL"

func GetMediaFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo) (*m.MetaDatum, error) {

	// get metadata from internet
	var newMd *m.MetaDatum
	var err = error(nil)

	if tor.Episode > 0 && tor.Season > 0 {
		newMd, err = getSeriesMetaData(tmdbClient, tor)
	} else {
		newMd, err = getMovieMetaData(tmdbClient, tor)
	}
	if err != nil {
		return nil, err
	}
	return newMd, nil
}

func GetEpisodeFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, md *m.MetaDatum) (*m.Episode, error) {

	// check if metadata is already in DB
	tmpEpMd, err := m.Episodes(
		qm.Where("tmdbSeriesId = ?", md.TMDBID),
		qm.Where("season = ?", tor.Season),
		qm.Where("episode = ?", tor.Episode),
	).OneG(context.Background())
	if err == nil {
		log.Println("using cached episode metadata")
		return tmpEpMd, nil
	}

	// get metadata from internet
	var epMd = &m.Episode{}
	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids",
	}
	epDetail, err := tmdbClient.GetTVEpisodeDetails(int(md.TMDBID.Int64), tor.Season, tor.Episode, detailsOptions)
	if err != nil {
		return nil, err
	}
	epMd.MetaDataId = md.ID
	epMd.Title = null.StringFrom(epDetail.Name)
	epMd.Plot = null.StringFrom(epDetail.Overview)
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

func getSeriesMetaData(tmdbClient *tmdb.Client, tor ptn.TorrentInfo) (*m.MetaDatum, error) {

	// check if metadata is already in cache
	tmdbSearchResult := TMDB_TV_SEARCH_CACHE[tor.Title]
	if tmdbSearchResult == nil {
		log.Println("searching TMDB TV for %s", tor.Title)

		options := map[string]string{}
		options["language"] = LANG
		// if year exists -> search with it
		year := null.StringFrom(strconv.Itoa(tor.Year))
		if year.Valid && year.String != "" {
			options["year"] = year.String
		}

		tmpTmdbSearchResult, err := tmdbClient.GetSearchTVShow(tor.Title, options)
		if err != nil {
			return nil, err
		}
		TMDB_TV_SEARCH_CACHE[tor.Title] = tmpTmdbSearchResult
		tmdbSearchResult = tmpTmdbSearchResult
	} else {
		log.Println("using cached for TMDB TV search: %s", tor.Title)
	}

	if tmdbSearchResult.TotalResults == 0 {
		return nil, fmt.Errorf("no series found for %s", tor.Title)
	}

	// check if metadata is not already id DB
	md, err := m.MetaData(qm.Where("tmdbId = ?", int(tmdbSearchResult.Results[0].ID))).OneG(context.Background())
	if err == nil {
		return md, nil
	}

	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids,genres,episodes,credits",
	}
	log.Println("getting TMDB TV details for %s", tor.Title)
	tmdbDetails, err := tmdbClient.GetTVDetails(int(tmdbSearchResult.Results[0].ID), detailsOptions)
	if err != nil {
		return nil, err
	}

	var newMd = &m.MetaDatum{}
	newMd.Title = null.StringFrom(tmdbDetails.Name)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("series")
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
	if tmdbDetails.CreatedBy != nil && len(tmdbDetails.CreatedBy) > 0 {
		newMd.Director = null.StringFrom(tmdbDetails.CreatedBy[0].Name)
	}
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

	return newMd, nil

}

func getMovieMetaData(tmdbClient *tmdb.Client, tor ptn.TorrentInfo) (*m.MetaDatum, error) {

	// check if metadata is already in cache
	var tmdbSearchResult = TMDB_MOVIE_SEARCH_CACHE[tor.Title]
	if tmdbSearchResult == nil {
		log.Println("searching TMDB MOVIE for %s", tor.Title)

		options := map[string]string{}
		options["language"] = LANG
		// if year exists -> search with it
		year := null.StringFrom(strconv.Itoa(tor.Year))
		if year.Valid && year.String != "" {
			options["year"] = year.String
		}

		tmpTmdbSearchResult, err := tmdbClient.GetSearchMovies(tor.Title, options)
		if err != nil {
			return nil, err
		}
		TMDB_MOVIE_SEARCH_CACHE[tor.Title] = tmpTmdbSearchResult
		tmdbSearchResult = tmpTmdbSearchResult
	} else {
		log.Println("using cached for TMDB MOVIE search: %s", tor.Title)
	}

	if tmdbSearchResult.TotalResults == 0 {
		return nil, fmt.Errorf("no movie found for %s", tor.Title)
	}

	// check if metadata is not already id DB
	md, err := m.MetaData(qm.Where("tmdbId = ?", int(tmdbSearchResult.Results[0].ID))).OneG(context.Background())
	if err == nil {
		return md, nil
	}

	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids,genres,credits,release_dates",
	}
	log.Println("getting TMDB MOVIE details for %s", tor.Title)
	tmdbDetails, err := tmdbClient.GetMovieDetails(int(tmdbSearchResult.Results[0].ID), detailsOptions)
	if err != nil {
		return nil, err
	}
	var newMd = &m.MetaDatum{}
	newMd.Title = null.StringFrom(tmdbDetails.Title)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("movie")
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
	return newMd, nil
}

//type MediaEntry interface {
//	m.MediaFile | m.TorrentFile
//	UpdateG(ctx context.Context, columns boil.Columns) (int64, error)
//}

//func HandleMetaDataGettingErr(file m.MediaFile, err error) bool {
//	if err != nil {
//		log.Println("handle metadata error:", err)
//		// update file row in db
//		file.MetaDataId = null.Int64From(0)
//		file.Status = null.StringFrom("error")
//		file.ScanError = null.StringFrom(err.Error())
//		_, _ = file.UpdateG(context.Background(), boil.Infer())
//		return true
//	} else {
//		return false
//	}
//}
//
//func HandleMetaDataGettingErr2(file m.TorrentFile, err error) bool {
//	if err != nil {
//		log.Println("handle metadata error:", err)
//		// update file row in db
//		file.MetaDataId = null.Int64From(0)
//		file.Status = null.StringFrom("error")
//		file.ScanError = null.StringFrom(err.Error())
//		_, _ = file.UpdateG(context.Background(), boil.Infer())
//		return true
//	} else {
//		return false
//	}
//}

func HandleMetaDataGettingErr(file interface{}, err error) bool {
	if err != nil {
		log.Println("handle metadata error:", err)
		// update file row in db
		switch f := file.(type) {
		case m.MediaFile:
			f.MetaDataId = null.Int64From(0)
			f.Status = null.StringFrom("error")
			f.ScanError = null.StringFrom(err.Error())
			_, _ = f.UpdateG(context.Background(), boil.Infer())
		case m.TorrentFile:
			f.MetaDataId = null.Int64From(0)
			f.Status = null.StringFrom("error")
			f.ScanError = null.StringFrom(err.Error())
			_, _ = f.UpdateG(context.Background(), boil.Infer())
		default:
			log.Println("unsupported file type", file)
			spew.Dump(file)
			return false
		}
		return true
	}
	return false
}

func GetMetaDataAndSaveToDB(file *m.MediaFile, tmdbClient *tmdb.Client, s *server.Server, i int, totalFiles int) {

	tor, err := ptn.Parse(file.Raw.String)
	if HandleMetaDataGettingErr(*file, err) {
		return
	}

	// try getting metadata from DB
	var md = &m.MetaDatum{}
	if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
		md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).OneG(context.Background())
		if HandleMetaDataGettingErr(*file, err) {
			return
		}
	} else {
		s.BroadcastMessage(fmt.Sprintf("Getting TMDB data [%d/%d] for %s", i, totalFiles, tor.Title))
		newMd, err := GetMediaFromTMDB(tmdbClient, *tor)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}

		// check if newMd is already saved
		if !newMd.ID.Valid {
			// save the metadata to the db
			log.Println("inserting metadata to DB")
			err = newMd.InsertG(context.Background(), boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}
		}
		md = newMd
	}

	// if it's a series get the episode
	if md.Series.Valid && md.Series.Bool {

		// try getting episode from DB
		log.Println("Getting episode metadata")
		msg := fmt.Sprintf("Getting TMDB data [%d/%d] for %s S%dE%d", i, totalFiles, md.Title.String, tor.Season,
			tor.Episode)
		s.BroadcastMessage(msg)
		epMd, err := GetEpisodeFromTMDB(tmdbClient, *tor, md)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}

		if !epMd.ID.Valid {
			// save the episode metadata to the db
			log.Println("inserting episode to DB")
			err = epMd.InsertG(context.Background(), boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}

			// update the user metadata for all users
			_, _ = m.UserMetaData(
				qm.Where("metaDataId = ?", md.ID),
			).UpdateAllG(context.Background(), m.M{"isWatched": false})
		}

		file.EpisodeId = epMd.ID
	}

	// update file foreignKey in db row
	file.MetaDataId = md.ID
	file.Status = null.StringFrom("scanned")
	_, _ = file.UpdateG(context.Background(), boil.Infer())
}

func GetMetaDataAndSaveToDB2(file *m.TorrentFile, tmdbClient *tmdb.Client, s *server.Server, i int, totalFiles int) {

	tor, err := ptn.Parse(file.Raw.String)
	if HandleMetaDataGettingErr(*file, err) {
		return
	}

	// try getting metadata from DB
	var md = &m.MetaDatum{}
	if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
		md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).OneG(context.Background())
		if HandleMetaDataGettingErr(*file, err) {
			return
		}
	} else {
		s.BroadcastMessage(fmt.Sprintf("Getting TMDB data [%d/%d] for %s", i, totalFiles, tor.Title))
		newMd, err := GetMediaFromTMDB(tmdbClient, *tor)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}

		// check if newMd is already saved
		if !newMd.ID.Valid {
			// save the metadata to the db
			log.Println("inserting metadata to DB")
			err = newMd.InsertG(context.Background(), boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}
		}
		md = newMd
	}

	// if it's a series get the episode
	if md.Series.Valid && md.Series.Bool {

		// try getting episode from DB
		log.Println("Getting episode metadata")
		msg := fmt.Sprintf("Getting TMDB data [%d/%d] for %s S%dE%d", i, totalFiles, md.Title.String, tor.Season,
			tor.Episode)
		s.BroadcastMessage(msg)
		epMd, err := GetEpisodeFromTMDB(tmdbClient, *tor, md)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}

		if !epMd.ID.Valid {
			// save the episode metadata to the db
			log.Println("inserting episode to DB")
			err = epMd.InsertG(context.Background(), boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}

			// update the user metadata for all users
			_, _ = m.UserMetaData(
				qm.Where("metaDataId = ?", md.ID),
			).UpdateAllG(context.Background(), m.M{"isWatched": false})
		}

		file.EpisodeId = epMd.ID
	}

	// update file foreignKey in db row
	file.MetaDataId = md.ID
	file.Status = null.StringFrom("scanned")
	_, _ = file.UpdateG(context.Background(), boil.Infer())
}
