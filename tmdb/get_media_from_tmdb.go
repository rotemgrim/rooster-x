package gtmdb

import (
	"context"
	"encoding/json"
	"fmt"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/ptnutil"
	"go-poc/server"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/davecgh/go-spew/spew"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

var (
	// keyed by searchKey; guarded by searchCacheMu, as websocket requests search too
	TMDB_TV_SEARCH_CACHE    = make(map[string]*tmdb.SearchTVShows)
	TMDB_MOVIE_SEARCH_CACHE = make(map[string]*tmdb.SearchMovies)
	searchCacheMu           sync.Mutex
	LANG                    = "en-US"
)

// var LANG = "he-IL"
func SetLang(lang string) {
	LANG = lang
}

func GetMediaFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo) (*m.MetaDatum, []string, error) {
	return GetMediaFromTMDBWithImdb(tmdbClient, tor, "", 0)
}

// GetMediaFromTMDBWithImdb resolves the TMDB title through the IMDb id when one
// is known, and falls back to searching TMDB by the parsed title otherwise.
// exclude is the TMDB id of a show that is known not to be the one (0 for none).
func GetMediaFromTMDBWithImdb(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, imdbId string, exclude int64) (*m.MetaDatum, []string, error) {
	tmdbID := findTMDBIDByImdb(tmdbClient, imdbId, isSeriesTorrent(tor))
	return getMediaByTMDBID(tmdbClient, tor, tmdbID, exclude)
}

// isSeriesTorrent says whether a torrent is of an episode rather than a movie.
func isSeriesTorrent(tor ptn.TorrentInfo) bool {
	return tor.Episode > 0 && tor.Season > 0
}

// getMediaByTMDBID builds the metadata of the TMDB title tmdbID, or of the one
// found by searching for the torrent's title when tmdbID is 0.
func getMediaByTMDBID(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, tmdbID, exclude int64) (*m.MetaDatum, []string, error) {
	// get metadata from internet
	var newMd *m.MetaDatum
	var genres []string
	err := error(nil)

	if isSeriesTorrent(tor) {
		newMd, genres, err = getSeriesMetaData(tmdbClient, tor, tmdbID, exclude)
	} else {
		newMd, genres, err = getMovieMetaData(tmdbClient, tor, tmdbID, exclude)
	}
	if err != nil {
		return nil, nil, err
	}
	return newMd, genres, nil
}

// findTMDBIDByImdb returns the TMDB id for an IMDb id, or 0 when there is no
// IMDb id, the lookup fails, or TMDB only knows it as the other media type.
func findTMDBIDByImdb(tmdbClient *tmdb.Client, imdbId string, isSeries bool) int64 {
	if !strings.HasPrefix(imdbId, "tt") {
		return 0
	}
	res, err := tmdbClient.GetFindByID(imdbId, map[string]string{"external_source": "imdb_id", "language": LANG})
	if err != nil {
		log.Printf("TMDB find by IMDb id %s failed: %v", imdbId, err)
		return 0
	}
	if isSeries && len(res.TvResults) > 0 {
		return res.TvResults[0].ID
	}
	if !isSeries && len(res.MovieResults) > 0 {
		return res.MovieResults[0].ID
	}
	log.Printf("TMDB has no matching title for IMDb id %s (series=%v), falling back to title search", imdbId, isSeries)
	return 0
}

func GetEpisodeFromTMDB(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, md *m.MetaDatum) (*m.Episode, error) {
	ctx := context.Background()
	// check if metadata is already in DB
	tmpEpMd, err := m.Episodes(
		qm.Where("tmdbSeriesId = ?", md.TMDBID),
		qm.Where("season = ?", tor.Season),
		qm.Where("episode = ?", tor.Episode),
	).One(ctx, db.DB)
	if err == nil {
		log.Println("using cached episode metadata")
		return tmpEpMd, nil
	}

	// get metadata from internet
	epMd := &m.Episode{}
	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids",
	}
	epDetail, err := tmdbClient.GetTVEpisodeDetails(int(md.TMDBID.Int64), tor.Season, tor.Episode, detailsOptions)
	if err != nil {
		// TMDB answers "code: 34 ... could not be found" for an episode the show doesn't have
		return nil, fmt.Errorf("TMDB has no S%02dE%02d of %s (%d): %w", tor.Season, tor.Episode,
			md.Title.String, md.Year.Int64, err)
	}
	epMd.MetaDataId = md.ID
	epMd.ImdbSeriesId = md.ImdbId
	epMd.TmdbSeriesId = md.TMDBID
	applyEpisodeDetails(epMd, epDetail)
	return epMd, nil
}

// applyEpisodeDetails copies TMDB's details of an episode onto ep.
func applyEpisodeDetails(ep *m.Episode, d *tmdb.TVEpisodeDetails) {
	ep.Title = null.StringFrom(d.Name)
	ep.Plot = null.StringFrom(d.Overview)
	ep.TMDBID = null.Int64From(d.ID)
	ep.Season = null.Int64From(int64(d.SeasonNumber))
	ep.Episode = null.Int64From(int64(d.EpisodeNumber))
	ep.Poster = null.StringFrom(d.StillPath)
	ep.Runtime = null.Int64From(int64(d.Runtime))
	ep.Released = null.StringFrom(d.AirDate)
	// convert date string like 2023-08-22 to unix timestamp
	if t, err := time.Parse("2006-01-02", d.AirDate); err == nil {
		ep.ReleasedUnix = null.Int64From(t.Unix())
	}
}

// getSeriesMetaData builds series metadata for tmdbID, searching TMDB by the
// parsed title first when tmdbID is 0, without finding the show exclude.
func getSeriesMetaData(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, tmdbID, exclude int64) (*m.MetaDatum, []string, error) {
	if tmdbID == 0 {
		id, err := searchSeriesTMDBID(tmdbClient, tor, exclude)
		if err != nil {
			return nil, nil, err
		}
		tmdbID = id
	}

	// check if metadata is not already id DB; a movie can have the same TMDB id
	ctx := context.Background()
	md, err := m.MetaData(qm.Where("tmdbId = ? AND series = 1", tmdbID)).One(ctx, db.DB)
	if err == nil {
		return md, nil, nil
	}

	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids,genres,episodes,credits,content_ratings",
	}
	log.Printf("getting TMDB TV details for %s", tor.Title)
	tmdbDetails, err := tmdbClient.GetTVDetails(int(tmdbID), detailsOptions)
	if err != nil {
		return nil, nil, err
	}
	return buildSeriesMetaData(tmdbDetails)
}

// searchSeriesTMDBID finds the TMDB id of the series named like the torrent,
// leaving out the show exclude (0 for none), which is a known wrong match.
func searchSeriesTMDBID(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, exclude int64) (int64, error) {
	id, err := searchSeries(tmdbClient, tor.Title, tor.Year, exclude)
	if err == nil && id == 0 && exclude != 0 && tor.Year != 0 {
		// the year may be what led to the wrong show, so look at the other years too
		id, err = searchSeries(tmdbClient, tor.Title, 0, exclude)
	}
	if err != nil {
		return 0, err
	}
	if id == 0 {
		return 0, fmt.Errorf("no series found for %s", tor.Title)
	}
	return id, nil
}

func searchSeries(tmdbClient *tmdb.Client, title string, year int, exclude int64) (int64, error) {
	key := searchKey(title, year)
	searchCacheMu.Lock()
	tmdbSearchResult := TMDB_TV_SEARCH_CACHE[key]
	searchCacheMu.Unlock()
	if tmdbSearchResult == nil {
		log.Printf("searching TMDB TV for %s", title)

		options := map[string]string{}
		options["language"] = LANG
		// if year exists -> search with it
		if year != 0 {
			options["year"] = strconv.Itoa(year)
		}

		tmpTmdbSearchResult, err := tmdbClient.GetSearchTVShow(title, options)
		if err != nil {
			return 0, err
		}
		searchCacheMu.Lock()
		TMDB_TV_SEARCH_CACHE[key] = tmpTmdbSearchResult
		searchCacheMu.Unlock()
		tmdbSearchResult = tmpTmdbSearchResult
	} else {
		log.Printf("using cached for TMDB TV search: %s", title)
	}

	return pickCandidate(title, exclude, seriesCandidates(tmdbSearchResult)), nil
}

func buildSeriesMetaData(tmdbDetails *tmdb.TVDetails) (*m.MetaDatum, []string, error) {
	newMd := &m.MetaDatum{}
	newMd.Title = null.StringFrom(tmdbDetails.Name)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("series")
	var genresArr []string
	for _, genre := range tmdbDetails.Genres {
		genresArr = append(genresArr, genre.Name)
	}
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
	if tmdbDetails.Credits.TVCredits != nil {
		for _, actor := range tmdbDetails.Credits.Cast {
			actors = append(actors, actor.Name)
		}
	}
	newMd.Actors = null.StringFrom(strings.Join(actors, ","))

	var countries []string
	for _, country := range tmdbDetails.OriginCountry {
		countries = append(countries, country)
	}
	newMd.Country = null.StringFrom(strings.Join(countries, ","))

	type networkEntry struct {
		Name string `json:"name"`
		Logo string `json:"logo,omitempty"`
	}
	var networks []networkEntry
	for _, n := range tmdbDetails.Networks {
		if n.Name != "" {
			networks = append(networks, networkEntry{Name: n.Name, Logo: n.LogoPath})
		}
	}
	if len(networks) > 0 {
		if jb, err := json.Marshal(networks); err == nil {
			newMd.Network = null.StringFrom(string(jb))
		}
	}

	if tmdbDetails.Tagline != "" {
		newMd.Tagline = null.StringFrom(tmdbDetails.Tagline)
	}
	if tmdbDetails.BackdropPath != "" {
		newMd.Backdrop = null.StringFrom(tmdbDetails.BackdropPath)
	}
	if tmdbDetails.Status != "" {
		newMd.ProductionStatus = null.StringFrom(tmdbDetails.Status)
	}
	if tmdbDetails.ContentRatings != nil && tmdbDetails.ContentRatings.TVContentRatingsResults != nil {
		// Prefer US rating, otherwise first non-empty
		var rating string
		for _, r := range tmdbDetails.ContentRatings.Results {
			if r.Iso3166_1 == "US" && r.Rating != "" {
				rating = r.Rating
				break
			}
		}
		if rating == "" {
			for _, r := range tmdbDetails.ContentRatings.Results {
				if r.Rating != "" {
					rating = r.Rating
					break
				}
			}
		}
		if rating != "" {
			newMd.AgeRating = null.StringFrom(rating)
		}
	}

	return newMd, genresArr, nil
}

// getMovieMetaData builds movie metadata for tmdbID, searching TMDB by the
// parsed title first when tmdbID is 0, without finding the movie exclude.
func getMovieMetaData(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, tmdbID, exclude int64) (*m.MetaDatum, []string, error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in getMovieMetaData for '%s': %v", tor.Title, r)
		}
	}()

	if tmdbID == 0 {
		id, err := searchMovieTMDBID(tmdbClient, tor, exclude)
		if err != nil {
			return nil, nil, err
		}
		tmdbID = id
	}
	return getMovieMetaDataByID(tmdbClient, tor, tmdbID)
}

// searchMovieTMDBID finds the TMDB id of the movie named like the torrent,
// leaving out the movie exclude (0 for none), which is a known wrong match.
func searchMovieTMDBID(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, exclude int64) (int64, error) {
	id, err := searchMovie(tmdbClient, tor.Title, tor.Year, exclude)
	if err == nil && id == 0 && exclude != 0 && tor.Year != 0 {
		// the year may be what led to the wrong movie, so look at the other years too
		id, err = searchMovie(tmdbClient, tor.Title, 0, exclude)
	}
	if err != nil {
		return 0, err
	}
	if id == 0 {
		return 0, fmt.Errorf("no movie found for %s", tor.Title)
	}
	return id, nil
}

func searchMovie(tmdbClient *tmdb.Client, title string, year int, exclude int64) (int64, error) {
	key := searchKey(title, year)
	searchCacheMu.Lock()
	tmdbSearchResult := TMDB_MOVIE_SEARCH_CACHE[key]
	searchCacheMu.Unlock()
	if tmdbSearchResult == nil {
		log.Printf("searching TMDB MOVIE for %s", title)

		options := map[string]string{}
		options["language"] = LANG
		// if year exists -> search with it
		if year != 0 {
			options["year"] = strconv.Itoa(year)
		}

		tmpTmdbSearchResult, err := tmdbClient.GetSearchMovies(title, options)
		if err != nil {
			log.Printf("Error from GetSearchMovies: %v", err)
			return 0, err
		}
		searchCacheMu.Lock()
		TMDB_MOVIE_SEARCH_CACHE[key] = tmpTmdbSearchResult
		searchCacheMu.Unlock()
		tmdbSearchResult = tmpTmdbSearchResult
	} else {
		log.Printf("using cached for TMDB MOVIE search: %s", title)
	}

	return pickCandidate(title, exclude, movieCandidates(tmdbSearchResult)), nil
}

func getMovieMetaDataByID(tmdbClient *tmdb.Client, tor ptn.TorrentInfo, tmdbID int64) (*m.MetaDatum, []string, error) {
	// check if metadata is not already id DB; a series can have the same TMDB id
	ctx := context.Background()
	md, err := m.MetaData(qm.Where("tmdbId = ? AND IFNULL(series, 0) = 0", tmdbID)).One(ctx, db.DB)
	log.Printf("DB check completed, err: %v", err)
	if err == nil {
		return md, nil, nil
	}

	detailsOptions := map[string]string{
		"language":           LANG,
		"append_to_response": "external_ids,genres,credits,release_dates",
	}
	log.Printf("getting TMDB MOVIE details for %s (ID: %d)", tor.Title, tmdbID)
	tmdbDetails, err := tmdbClient.GetMovieDetails(int(tmdbID), detailsOptions)
	log.Printf("GetMovieDetails returned, err: %v", err)
	if err != nil {
		log.Printf("Error from GetMovieDetails: %v", err)
		return nil, nil, err
	}

	log.Printf("Building metadata object for: %s", tor.Title)
	newMd := &m.MetaDatum{}
	log.Printf("Setting basic fields...")
	newMd.Title = null.StringFrom(tmdbDetails.Title)
	newMd.Poster = null.StringFrom(tmdbDetails.PosterPath)
	newMd.Type = null.StringFrom("movie")

	log.Printf("Processing genres...")
	var genresArr []string
	for _, genre := range tmdbDetails.Genres {
		genresArr = append(genresArr, genre.Name)
	}

	log.Printf("Setting IDs...")
	newMd.ImdbId = null.StringFrom(tmdbDetails.IMDbID)
	newMd.TMDBID = null.Int64From(tmdbDetails.ID)
	newMd.Series = null.BoolFrom(false)

	log.Printf("Parsing release date: %s", tmdbDetails.ReleaseDate)
	if tmdbDetails.ReleaseDate != "" {
		year, _ := strconv.ParseInt(strings.Split(tmdbDetails.ReleaseDate, "-")[0], 10, 64)
		newMd.Year = null.Int64From(year)

		// convert date string like 2023-08-22 to unix timestamp
		layout := "2006-01-02"
		t, err := time.Parse(layout, tmdbDetails.ReleaseDate)
		if err == nil {
			newMd.ReleasedUnix = null.Int64From(t.Unix())
		}
	}

	log.Printf("Setting other fields...")
	newMd.Plot = null.StringFrom(tmdbDetails.Overview)
	newMd.Runtime = null.Int64From(int64(tmdbDetails.Runtime))
	newMd.Released = null.StringFrom(tmdbDetails.ReleaseDate)

	log.Printf("Processing credits cast...")
	var actors []string
	if tmdbDetails.Credits.MovieCredits != nil {
		for _, actor := range tmdbDetails.Credits.Cast {
			actors = append(actors, actor.Name)
		}
	}
	newMd.Actors = null.StringFrom(strings.Join(actors, ","))

	log.Printf("Processing origin countries...")
	var countries []string
	for _, country := range tmdbDetails.OriginCountry {
		countries = append(countries, country)
	}
	newMd.Country = null.StringFrom(strings.Join(countries, ","))

	log.Printf("Processing production companies...")
	type companyEntry struct {
		Name string `json:"name"`
		Logo string `json:"logo,omitempty"`
	}
	var companies []companyEntry
	for _, c := range tmdbDetails.ProductionCompanies {
		if c.Name != "" {
			companies = append(companies, companyEntry{Name: c.Name, Logo: c.LogoPath})
		}
	}
	if len(companies) > 0 {
		if jb, err := json.Marshal(companies); err == nil {
			newMd.Network = null.StringFrom(string(jb))
		}
	}

	if tmdbDetails.Tagline != "" {
		newMd.Tagline = null.StringFrom(tmdbDetails.Tagline)
	}
	if tmdbDetails.BackdropPath != "" {
		newMd.Backdrop = null.StringFrom(tmdbDetails.BackdropPath)
	}
	if tmdbDetails.Status != "" {
		newMd.ProductionStatus = null.StringFrom(tmdbDetails.Status)
	}
	if tmdbDetails.ReleaseDates != nil && tmdbDetails.ReleaseDates.MovieReleaseDatesResults != nil {
		// Prefer US certification, otherwise first non-empty
		var cert string
		for _, r := range tmdbDetails.ReleaseDates.Results {
			if r.Iso3166_1 == "US" {
				for _, rd := range r.ReleaseDates {
					if rd.Certification != "" {
						cert = rd.Certification
						break
					}
				}
				if cert != "" {
					break
				}
			}
		}
		if cert == "" {
			for _, r := range tmdbDetails.ReleaseDates.Results {
				for _, rd := range r.ReleaseDates {
					if rd.Certification != "" {
						cert = rd.Certification
						break
					}
				}
				if cert != "" {
					break
				}
			}
		}
		if cert != "" {
			newMd.AgeRating = null.StringFrom(cert)
		}
	}

	log.Printf("Successfully created metadata for: %s", tor.Title)
	return newMd, genresArr, nil
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
		ctx := context.Background()
		switch f := file.(type) {
		case m.MediaFile:
			f.MetaDataId = null.Int64From(0)
			f.Status = null.StringFrom("error")
			f.ScanError = null.StringFrom(err.Error())
			_, _ = f.Update(ctx, db.DB, boil.Infer())
		case m.TorrentFile:
			f.MetaDataId = null.Int64From(0)
			f.Status = null.StringFrom("error")
			f.ScanError = null.StringFrom(err.Error())
			_, _ = f.Update(ctx, db.DB, boil.Infer())
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
	ctx := context.Background()
	tor, err := ptnutil.SafeParse(file.Raw.String)
	if HandleMetaDataGettingErr(*file, err) {
		return
	}

	// try getting metadata from DB
	md := &m.MetaDatum{}
	if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
		md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).One(ctx, db.DB)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}
	} else {
		s.BroadcastMessage(fmt.Sprintf("Getting TMDB data [%d/%d] for %s", i, totalFiles, tor.Title))
		newMd, genres, err := GetMediaFromTMDB(tmdbClient, *tor)
		if HandleMetaDataGettingErr(*file, err) {
			return
		}

		// check if newMd is already saved
		if !newMd.ID.Valid {
			// save the metadata to the db
			log.Println("inserting metadata to DB")
			err = newMd.Insert(ctx, db.DB, boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}

			// Save genres in many-to-many table
			if len(genres) > 0 {
				if err := db.SaveGenresForMetaData(newMd.ID.Int64, genres); err != nil {
					log.Printf("Warning: Could not save genres for metadata %d: %v", newMd.ID.Int64, err)
				}
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
			err = epMd.Insert(ctx, db.DB, boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return
			}

			// update the user metadata for all users
			_, _ = m.UserMetaData(
				qm.Where("metaDataId = ?", md.ID),
			).UpdateAll(ctx, db.DB, m.M{"isWatched": false})
		}

		file.EpisodeId = epMd.ID
	}

	// update file foreignKey in db row
	file.MetaDataId = md.ID
	file.Status = null.StringFrom("scanned")
	_, _ = file.Update(ctx, db.DB, boil.Infer())
}

func GetMetaDataAndSaveToDB2(file *m.TorrentFile, tmdbClient *tmdb.Client, s *server.Server, i int, totalFiles int) {
	_ = matchTorrent(file, tmdbClient, s.BroadcastMessage, i, totalFiles, 0, false, 0)
}

// matchTorrent finds the TMDB title (and episode) of a torrent and links the
// torrent to them. When it fails, it returns the error, which is also saved on
// the torrent. A title that is known not to be the one (exclude, its TMDB id) is
// not matched, and ignoreImdb leaves out the IMDb id the torrent came with, which
// may be what led to the wrong title. A chosen title (chosen, its TMDB id) is
// matched without searching.
func matchTorrent(file *m.TorrentFile, tmdbClient *tmdb.Client, say func(string), i int, totalFiles int, exclude int64, ignoreImdb bool, chosen int64) error {
	ctx := context.Background()
	tor, err := ptnutil.SafeParse(file.Raw.String)
	if HandleMetaDataGettingErr(*file, err) {
		return err
	}

	// try getting metadata from DB
	md := &m.MetaDatum{}
	var genres []string
	if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
		md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).One(ctx, db.DB)
		if HandleMetaDataGettingErr(*file, err) {
			return err
		}
	} else {
		say(fmt.Sprintf("Getting TMDB data [%d/%d] for %s", i, totalFiles, tor.Title))
		// imdbId comes from apibay; the sqlboiler model predates the column
		var imdbId null.String
		if !ignoreImdb {
			_ = db.DB.QueryRow(`SELECT imdbId FROM torrentFile WHERE id = ?`, file.ID).Scan(&imdbId)
		}
		if chosen != 0 {
			md, genres, err = getMediaByTMDBID(tmdbClient, *tor, chosen, 0)
		} else {
			md, genres, err = GetMediaFromTMDBWithImdb(tmdbClient, *tor, imdbId.String, exclude)
		}
		if HandleMetaDataGettingErr(*file, err) {
			return err
		}
	}

	// if it's a series get the episode, before saving a new series, so that an
	// episode TMDB does not know leaves no series without episodes behind
	var epMd *m.Episode
	if md.Series.Valid && md.Series.Bool {
		msg := fmt.Sprintf("Getting TMDB data [%d/%d] for %s S%dE%d", i, totalFiles, md.Title.String, tor.Season,
			tor.Episode)
		say(msg)
		epMd, err = GetEpisodeFromTMDB(tmdbClient, *tor, md)
		if HandleMetaDataGettingErr(*file, err) {
			return err
		}
	}

	// check if md is already saved
	if !md.ID.Valid {
		// save the metadata to the db
		log.Printf("inserting metadata to DB: %s\n", md.Title.String)
		err = md.Insert(ctx, db.DB, boil.Infer())
		if HandleMetaDataGettingErr(*file, err) {
			return err
		}

		// Save genres in many-to-many table
		if len(genres) > 0 {
			if err := db.SaveGenresForMetaData(md.ID.Int64, genres); err != nil {
				log.Printf("Warning: Could not save genres for metadata %d: %v", md.ID.Int64, err)
			}
		}
	}

	if epMd != nil {
		if !epMd.ID.Valid {
			// save the episode metadata to the db
			log.Printf("inserting episode to DB: %s S%dE%d\n", md.Title.String, tor.Season, tor.Episode)
			epMd.MetaDataId = md.ID
			err = epMd.Insert(ctx, db.DB, boil.Infer())
			if HandleMetaDataGettingErr(*file, err) {
				return err
			}

			log.Printf("updating user metadata for %s\n", md.Title.String)

			// update the user metadata for all users
			_, _ = m.UserMetaData(
				qm.Where("metaDataId = ?", md.ID),
			).UpdateAll(ctx, db.DB, m.M{"isWatched": false})
		}

		file.EpisodeId = epMd.ID
	}

	// update file foreignKey in db row
	file.MetaDataId = md.ID
	file.Status = null.StringFrom("scanned")
	_, err = file.Update(ctx, db.DB, boil.Infer())
	return err
}
