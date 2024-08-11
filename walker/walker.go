package walker

import (
	"context"
	"encoding/json"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/friendsofgo/errors"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/server"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

const dir = "B:\\downloads\\complete\\"

// filter is a list of strings that we want to filter out
var dirFilter = []string{"sample", "samples", "moudles", "git", "subs"}
var includeExtensions = []string{"mkv", "avi", "3g2", "3gp", "aaf", "asf", "avchd",
	"m2v", "m4p", "m4v", "mng", "mov", "mp2", "mp4", "mpe", "mpeg", "mpg",
	"mpv", "mxf", "nsv", "ogg", "ogv", "qt", "rm", "rmvb", "roq", "svi",
	"vob", "webm", "wmv"}

type FileEntry struct {
	m *ptn.TorrentInfo
	s os.FileInfo
}

type Walker struct {
	walkDir string
	server  *server.Server
}

func NewWalker(walkDir string, server *server.Server) *Walker {
	return &Walker{
		walkDir: walkDir,
		server:  server,
	}
}

func (w *Walker) FullSweep() {

	if checkIfSweepIsRunning() {
		return
	}
	defer os.Remove("sweep.lock")

	fmt.Println("Starting full sweep")

	// read from file system
	entries, err := w.getMediaFilesFromDisk(w.walkDir)
	if err != nil {
		fmt.Println("Error getting torrents")
		return
	}

	// insert into db (not duplicates)
	w.insertMediaFilesToDB(entries)

	// get all missing metadata for files and query TMDB
	filesWithoutMetaData, err := m.MediaFiles(qm.Where(`metaDataId IS NULL`)).AllG(context.Background())
	if err != nil {
		fmt.Println("no files without metadata found, skipping")
		return
	}

	tmdbClient, err := tmdb.Init("REMOVED_TMDB_API_KEY")
	if err != nil {
		fmt.Println("Error initializing tmdb client")
		return
	}
	for _, file := range filesWithoutMetaData {
		tor, err := ptn.Parse(file.Raw.String)
		if handleMetaDataGettingErr(*file, err) {
			continue
		}

		// get metadata from internet
		var newMd = &m.MetaDatum{}
		if tor.Episode > 0 && tor.Season > 0 {
			//options["season_number"] = fmt.Sprintf("%d", tor.Season)
			//options["episode_number"] = fmt.Sprintf("%d", tor.Episode)
			tmdbMetaData, err := tmdbClient.GetSearchTVShow(tor.Title, nil)
			if handleMetaDataGettingErr(*file, err) {
				continue
			}
			detailsOptions := map[string]string{
				"append_to_response": "external_ids,genres,episodes",
			}
			tmdbDetails, err := tmdbClient.GetTVDetails(int(tmdbMetaData.Results[0].ID), detailsOptions)

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

			// save the metadata to the db
			newMd.InsertGP(context.Background(), boil.Infer())
			file.MetaDataId = newMd.ID
			_, _ = file.UpdateG(context.Background(), boil.Infer())
		} else {

			metaData, err := tmdbClient.GetSearchMovies(tor.Title, nil)
			if handleMetaDataGettingErr(*file, err) {
				continue
			}
			detailsOptions := map[string]string{
				"append_to_response": "external_ids,genres",
			}
			tmdbDetails, err := tmdbClient.GetMovieDetails(int(metaData.Results[0].ID), detailsOptions)

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
			newMd.Released = null.StringFrom(tmdbDetails.ReleaseDates.MovieReleaseDatesResults.Results[0].ReleaseDates[0].ReleaseDate)
			newMd.Runtime = null.Int64From(int64(tmdbDetails.Runtime))

			// save the metadata to the db
			newMd.InsertGP(context.Background(), boil.Infer())
			file.MetaDataId = newMd.ID
			_, _ = file.UpdateG(context.Background(), boil.Infer())
		}
	}
}

type TMDBSearchResult struct {
	Page         int64 `json:"page"`
	TotalResults int64 `json:"total_results"`
	TotalPages   int64 `json:"total_pages"`
	*TMDBMetaData
}
type TMDBMetaData struct {
	Results []struct {
		OriginalName     string   `json:"original_name"`
		ID               int64    `json:"id"`
		Name             string   `json:"name"`
		VoteCount        int64    `json:"vote_count"`
		VoteAverage      float32  `json:"vote_average"`
		PosterPath       string   `json:"poster_path"`
		FirstAirDate     string   `json:"first_air_date"`
		Popularity       float32  `json:"popularity"`
		GenreIDs         []int64  `json:"genre_ids"`
		OriginalLanguage string   `json:"original_language"`
		BackdropPath     string   `json:"backdrop_path"`
		Overview         string   `json:"overview"`
		OriginCountry    []string `json:"origin_country"`
	} `json:"results"`
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

func get(url string, data interface{}) error {
	if url == "" {
		return errors.New("url field is empty")
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("could not fetch the url: %s", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req = req.WithContext(ctx)
	req.Header.Add("content-type", "application/json;charset=utf-8")
	//req.Header.Add("Authorization", "Bearer "+c.bearerToken)
	for {
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests {
			//time.Sleep(retryDuration(res))
			//continue
			return nil
		}
		if res.StatusCode == http.StatusNoContent {
			return nil
		}
		if res.StatusCode != http.StatusOK {
			return nil
		}
		if err = json.NewDecoder(res.Body).Decode(data); err != nil {
			return fmt.Errorf("could not decode the data: %s", err)
		}
		break
	}
	return nil
}

func fmtOptions(
	urlOptions map[string]string,
) string {
	options := ""
	if len(urlOptions) > 0 {
		for key, value := range urlOptions {
			options += fmt.Sprintf(
				"&%s=%s",
				key,
				url.QueryEscape(value),
			)
		}
	}
	return options
}

func handleMetaDataGettingErr(file m.MediaFile, err error) bool {
	if err != nil {
		fmt.Println("Error getting metadata from tmdb")
		// update file row in db
		file.MetaDataId = null.Int64From(0)
		_, _ = file.UpdateG(context.Background(), boil.Infer())
		return true
	} else {
		return false
	}
}

func fileExists(path string, files m.MediaFileSlice) bool {
	for _, file := range files {
		if file.Path.String == path {
			return true
		}
	}
	return false
}

func (w *Walker) insertMediaFilesToDB(entries []m.MediaFile) {
	// get all movies from metadata
	//movies := m.MetaData(m.MetaDatumWhere.Type.EQ(`movie`)).AllGP(db.CTX)
	//
	//// get all tv shows from metadata
	//tvShows := m.MetaData(qm.Where(`type=?`, `series`)).AllGP(db.CTX)
	//
	//// get all episodes from episodes
	//episodes := m.Episodes().AllGP(db.CTX)
	//

	fmt.Println("start adding files to db")

	// get all files from files
	files, err := m.MediaFiles(qm.Select("id", "hash", "path")).AllG(context.Background())
	if err != nil {
		files = []*m.MediaFile{}
	}

	skippedFiles := 0
	addedFiles := 0
	for _, entry := range entries {
		fullPath := entry.Path.String

		// add genres to db
		//for _, genre := range entry.m.Genres {
		//	m.Genres(m.GenreWhere.Name.EQ(genre)).InsertGP(db.CTX, db.DB, m.GenreColumns.Name)
		//}

		// skip if path exist
		if fileExists(fullPath, files) {
			continue
		}

		ctx := context.Background()
		err := entry.InsertG(ctx, boil.Infer())
		if err != nil {
			skippedFiles++
		} else {
			addedFiles++
		}
		fmt.Printf("\rskipped files: %d, added: %d", skippedFiles, addedFiles)
	}
	fmt.Printf("\ndone adding files to db %d \n", addedFiles)
}

func (w *Walker) getMediaFilesFromDisk(dir string) ([]m.MediaFile, error) {
	var result []m.MediaFile

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// check if directory contains any of the filter strings case-insensitive
		if info.IsDir() && stringInSlice(info.Name(), dirFilter) {
			return filepath.SkipDir
		}

		// check if file extension is not in the includeExtensions list
		if !info.IsDir() && stringInSlice(info.Name(), includeExtensions) {
			tor, err := ptn.Parse(info.Name())
			if err != nil {
				fmt.Println("Error parsing torrent name")
				return nil
			}

			if len(tor.Title) < 3 {
				return nil
			}

			if countSetProperties(tor) < 5 {
				return nil
			}

			re := regexp.MustCompile(`^[0-9]{2,3}[\s|.|_|-]`)
			if re.MatchString(tor.Title) {
				return nil
			}

			// convert the torrent to a json string
			// torJson, _ := json.Marshal(tor)
			// fmt.Println("Torrent name: ", string(torJson))

			// print the number of torrents to console without adding a newline
			//fmt.Printf("\rNumber of torrents found: %d", len(result))
			str := fmt.Sprintf("Number of torrents found: %d", len(result))
			w.server.BroadcastMessage(str)

			// calculate checksum
			//hash, err := hashFile(path)
			//if err != nil {
			//	return nil
			//}

			mf := m.MediaFile{
				Raw:  null.StringFrom(info.Name()),
				Path: null.StringFrom(strings.ToLower(path)),
				//Hash: null.StringFrom(hash),
				Size: null.Int64From(info.Size()),
				//MetaDataId:   null.Int64{},
				//EpisodeId:    null.Int64{},

				Year:         null.Int64From(int64(tor.Year)),
				Resolution:   null.StringFrom(tor.Resolution),
				Quality:      null.StringFrom(tor.Quality),
				Codec:        null.StringFrom(tor.Codec),
				Audio:        null.StringFrom(tor.Audio),
				Group:        null.StringFrom(tor.Group),
				Region:       null.StringFrom(tor.Region),
				Language:     null.StringFrom(tor.Language),
				Extended:     null.BoolFrom(tor.Extended),
				Hardcoded:    null.BoolFrom(tor.Hardcoded),
				Proper:       null.BoolFrom(tor.Proper),
				Repack:       null.BoolFrom(tor.Repack),
				WideScreen:   null.BoolFrom(tor.Widescreen),
				DownloadedAt: null.TimeFrom(info.ModTime()),
			}

			// get the meta data
			//getMetaData(&mf, tor)

			result = append(result, mf)
		}

		return nil
	})
	if err != nil {
		fmt.Printf("Error walking the path %q: %v\n", dir, err)
		return nil, err
	}

	// print the number of torrents found
	fmt.Println("\rNumber of torrents found: ", len(result))
	return result, nil
}

func checkIfSweepIsRunning() bool {

	// check if sweep is already running
	if _, err := os.Stat("sweep.lock"); err == nil {
		fmt.Println("Sweep already running")
		return true
	}
	// create a lock file
	_, err := os.Create("sweep.lock")
	if err != nil {
		fmt.Println("Error creating lock file")
	}

	return false
}

func stringInSlice(str string, extensions []string) bool {
	for _, e := range extensions {
		if strings.Contains(strings.ToLower(str), e) {
			return true
		}
	}
	return false
}

func countSetProperties(entry *ptn.TorrentInfo) int {
	v := reflect.ValueOf(entry).Elem()
	count := 0
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		if !field.IsZero() {
			count++
		}
	}
	return count
}

type MediaType string

const (
	Movie  MediaType = "movie"
	Series MediaType = "series"
)

func getMetaData(mf *m.MediaFile, tor *ptn.TorrentInfo) {
	var t MediaType
	if tor.Episode > 0 && tor.Season > 0 {
		t = Series
	} else {
		t = Movie
	}

	// get the meta data
	//md := m.MetaData(qm.Where(`type=?`, t), qm.Where(`title=?`, tor.Title)).OneGP(context.Background())

	md, err := m.MetaData().OneG(context.Background())
	if err != nil {
		// create a new metadata
		md = &m.MetaDatum{
			Title:  null.StringFrom(tor.Title),
			Type:   null.StringFrom(string(t)),
			Status: null.StringFrom("not-scanned"),
		}
		// get the meta data from the internet
		//md = getMetaDataFromInternetByMediaFile(md)
		md.InsertGP(context.Background(), boil.Infer())
	} else {
		mf.MetaDataId = md.ID
		if t == Series {
			episode, err := m.Episodes(
				qm.Where(`season=?`, tor.Season),
				qm.Where(`episode=?`, tor.Episode),
			).OneG(db.CTX)
			if err != nil && episode != nil {
				mf.EpisodeId = episode.ID
			}
		}
	}
}
