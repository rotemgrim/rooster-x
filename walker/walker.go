package walker

import (
	"context"
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/server"
	tmdb2 "go-poc/tmdb"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
)

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
	walkDirArr []string
	server     *server.Server
	tmdbClient *tmdb.Client
}

func NewWalker(walkDirArr []string, server *server.Server, tmdbClient *tmdb.Client) *Walker {
	return &Walker{
		walkDirArr: walkDirArr,
		server:     server,
		tmdbClient: tmdbClient,
	}
}

func (w *Walker) FullSweep() {

	if checkIfSweepIsRunning() {
		return
	}
	defer os.Remove("sweep.lock")

	fmt.Println("Starting full sweep")

	// read from file system, accumulate all files
	var entries []m.MediaFile
	for _, dir := range w.walkDirArr {
		tmpEntries, err := w.getMediaFilesFromDisk(dir)
		if err != nil {
			fmt.Println("Error getting torrents")
			continue
		}
		entries = append(entries, tmpEntries...)
	}

	if entries == nil || len(entries) == 0 {
		fmt.Println("No files found")
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

	tmdbClient := w.tmdbClient
	for _, file := range filesWithoutMetaData {
		tor, err := ptn.Parse(file.Raw.String)
		if tmdb2.HandleMetaDataGettingErr(*file, err) {
			continue
		}

		// try getting metadata from DB
		var md = &m.MetaDatum{}
		if file.MetaDataId.Valid && !file.MetaDataId.IsZero() {
			md, err = m.MetaData(qm.Where("id = ?", file.MetaDataId.Int64)).OneG(context.Background())
			if tmdb2.HandleMetaDataGettingErr(*file, err) {
				continue
			}
		} else {
			newMd, err := tmdb2.GetMediaFromTMDB(tmdbClient, *tor)
			if tmdb2.HandleMetaDataGettingErr(*file, err) {
				continue
			}

			// check if newMd is already saved
			if !newMd.ID.Valid {
				// save the metadata to the db
				fmt.Println("inserting metadata to DB")
				err = newMd.InsertG(context.Background(), boil.Infer())
				if tmdb2.HandleMetaDataGettingErr(*file, err) {
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
			if tmdb2.HandleMetaDataGettingErr(*file, err) {
				continue
			}

			if !epMd.ID.Valid {
				// save the episode metadata to the db
				fmt.Println("inserting episode to DB")
				err = epMd.InsertG(context.Background(), boil.Infer())
				if tmdb2.HandleMetaDataGettingErr(*file, err) {
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

			fmt.Sprintf("scanning name: %s", tor.Title)
			//fmt.Printf("scanning name: %s\n", tor.Title)

			if len(tor.Title) < 3 {
				return nil
			}

			if countSetProperties(tor) < 3 {
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
			Title: null.StringFrom(tor.Title),
			Type:  null.StringFrom(string(t)),
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
