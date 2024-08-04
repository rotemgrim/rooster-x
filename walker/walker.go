package walker

import (
	"context"
	"fmt"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/server"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
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

	entries, err := w.getMediaFilesFromDisk(w.walkDir)
	if err != nil {
		fmt.Println("Error getting torrents")
		return
	}

	fmt.Println("Number of entries END: ", len(entries))
	// get all movies from metadata
	//movies := m.MetaData(m.MetaDatumWhere.Type.EQ(`movie`)).AllGP(db.CTX)
	//
	//// get all tv shows from metadata
	//tvShows := m.MetaData(qm.Where(`type=?`, `series`)).AllGP(db.CTX)
	//
	//// get all episodes from episodes
	//episodes := m.Episodes().AllGP(db.CTX)
	//
	//// get all files from files
	files := m.MediaFiles(qm.Select("id", "hash", "path")).AllGP(db.CTX)
	skippedFiles := 0
	addedFiles := 0
	for _, entry := range entries {
		fullPath := entry.Raw.String

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
	fmt.Println("\ndone adding files to db")
}

func fileExists(path string, files m.MediaFileSlice) bool {
	for _, file := range files {
		if file.Path.String == path {
			return true
		}
	}
	return false
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
			fmt.Printf("\rNumber of torrents found: %d", len(result))
			w.server.BroadcastMessage(fmt.Sprintf("Number of torrents found: %d", len(result)))

			// calculate checksum
			//hash, err := hashFile(path)
			//if err != nil {
			//	return nil
			//}

			mf := m.MediaFile{
				Raw:  null.StringFrom(path),
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
