package walker

import (
	"context"
	"fmt"
	"go-poc/db"
	EventBus "go-poc/event-bus"
	m "go-poc/models"
	"go-poc/ptnutil"
	"go-poc/server"
	gtmdb "go-poc/tmdb"
	"log"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/fsnotify/fsnotify"
	ptn "github.com/middelink/go-parse-torrent-name"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

// filter is a list of strings that we want to filter out
var dirFilter = []string{"sample", "samples", "moudles", "git", "subs"}
var includeExtensions = []string{
	"mkv", "avi", "3g2", "3gp", "aaf",
	"m2v", "m4p", "m4v", "mov", "mp2", "mp4", "mpe", "mpeg", "mpg",
	//"mpv", "mxf", "nsv", "ogg", "ogv", "qt", "rm", "rmvb", "roq", "svi",
	//"vob", "webm", "wmv",
}

type FileEntry struct {
	m *ptn.TorrentInfo
	s os.FileInfo
}

type Walker struct {
	walkDirArr []string
	server     *server.Server
	tmdbClient *tmdb.Client
	watcher    *fsnotify.Watcher
}

func NewWalker(walkDirArr []string, server *server.Server, tmdbClient *tmdb.Client) *Walker {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		panic(err)
	}

	return &Walker{
		walkDirArr: walkDirArr,
		server:     server,
		tmdbClient: tmdbClient,
		watcher:    watcher,
	}
}

func (w *Walker) StopWatch() {
	_ = w.watcher.Close()
}

func (w *Walker) StartWatch() {

	go w.debounceWatch(w.watcher)

	// Watch only the configured roots. fsnotify is non-recursive, but on
	// every platform a watched directory ALSO reports events for its
	// direct children (file creates/removes, plus Write events on a
	// child directory whenever its own contents change). For our typical
	// layout — <root>/<release-folder>/<file.mkv> — that is enough:
	//   * file added/removed directly under <root>      -> Create/Remove
	//   * file added/removed inside <release-folder>    -> Write on
	//     <release-folder> (handled by the Write-on-dir branch in
	//     debounceWatch, which re-sweeps that folder + prunes).
	// Anything deeper than one level relies on the scheduled FullSweep.
	// This keeps us at N OS handles (N = configured roots) instead of
	// thousands.
	for _, dir := range w.walkDirArr {
		if err := w.watcher.Add(dir); err != nil {
			log.Printf("Error watching directory %s: %v", dir, err)
		} else {
			log.Println("Watching directory: ", dir)
		}
	}
}

func (w *Walker) debounceWatch(watcher *fsnotify.Watcher) {
	var (
		// Wait 1000ms for new events; each new event resets the timer.
		waitFor = 1000 * time.Millisecond

		// Keep track of the timers, as path → timer.
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)

		// Callback we run.
		callBack = func(e fsnotify.Event) {
			log.Println(e.String())

			changed := false
			switch {
			case e.Op&fsnotify.Create == fsnotify.Create:
				log.Println("Create event")
				// e.Name may be a file or a directory created directly
				// under a watched root. Either way Sweep() will
				// filepath.Walk it (a single file path is a 1-entry
				// walk) and pick up any media files. Subsequent files
				// dropped INTO a newly-created subfolder are caught by
				// the Write-on-dir branch below — the subfolder is a
				// direct child of the watched root, so its Write
				// events surface even though we don't Add() it.
				w.Sweep([]string{e.Name})
				changed = true
			case e.Op&fsnotify.Remove == fsnotify.Remove:
				log.Printf("Remove event: %s", e.Name)
				_ = w.removeAllDeletedMediaFiles()
				changed = true
			case e.Op&fsnotify.Rename == fsnotify.Rename:
				log.Printf("Rename event: %s", e.Name)
				w.Sweep([]string{e.Name})
				_ = w.removeAllDeletedMediaFiles()
				changed = true
			case e.Op&fsnotify.Write == fsnotify.Write:
				// On Windows, fsnotify often reports a file delete/move
				// inside a watched directory as a Write on the *directory*
				// (not a Remove on the file). So if the Write target is a
				// directory, treat it as a "contents changed" signal:
				// re-sweep it (in case files appeared) AND prune deleted
				// rows. If it's a regular file Write, ignore as before.
				if info, statErr := os.Stat(e.Name); statErr == nil && info.IsDir() {
					log.Printf("Write event on directory (contents changed): %s", e.Name)
					w.Sweep([]string{e.Name})
					_ = w.removeAllDeletedMediaFiles()
					changed = true
				} else if os.IsNotExist(statErr) {
					// The path itself vanished between the event and our
					// Stat — treat as a removal.
					log.Printf("Write event on missing path, treating as removal: %s", e.Name)
					_ = w.removeAllDeletedMediaFiles()
					changed = true
				} else {
					log.Printf("Write event (do nothing): %s", e.Name)
				}
			case e.Op&fsnotify.Chmod == fsnotify.Chmod:
				log.Printf("Chmod event (do nothing): %s", e.Name)
			}

			// After any mutation, refresh the materialised feed snapshots
			// so the UI's reload hits fresh aggregates, then broadcast once.
			if changed {
				db.RebuildFeeds()
				w.server.BroadcastMessage("reload")
			}

			// Don't need to remove the timer if you don't have a lot of files.
			mu.Lock()
			delete(timers, e.Name)
			mu.Unlock()
		}
	)

	for {
		select {
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Println("error:", err)

		case event, ok := <-watcher.Events:
			if !ok {
				return
			}

			// We just want to watch for file creation, so ignore everything
			// outside of Create and Write.
			//if !e.Has(fsnotify.Create) && !e.Has(fsnotify.Write) {
			//	continue
			//}

			// Get timer.
			mu.Lock()
			t, ok := timers[event.Name]
			mu.Unlock()

			// No timer yet, so create one.
			if !ok {
				t = time.AfterFunc(math.MaxInt64, func() {
					callBack(event)
				})
				t.Stop()

				mu.Lock()
				timers[event.Name] = t
				mu.Unlock()
			}

			// Reset the timer for this path, so it will start from 100ms again.
			t.Reset(waitFor)

		}
	}
}

func (w *Walker) releaseLock(msg string) {
	if msg != "" {
		log.Println(msg)
		w.server.BroadcastMessage(msg)
	}
	_ = os.Remove("sweep.lock")
	EventBus.SendEvent("sweep-done", nil)
}

func (w *Walker) GetEntriesFromPaths(paths []string) []m.MediaFile {
	var entries []m.MediaFile
	for _, dir := range paths {
		tmpEntries, err := w.getMediaFilesFromDisk(dir)
		if err != nil {
			log.Printf("Error getting media files from %s", dir)
			continue
		}
		entries = append(entries, tmpEntries...)
	}
	return entries
}

func (w *Walker) removeAllDeletedMediaFiles() error {
	ctx := context.Background()
	// get all media files
	mediaFiles, err := m.MediaFiles().All(ctx, db.DB)
	if err != nil {
		return fmt.Errorf("could not get media files: %w", err)
	}
	w.removeDeletedMediaFiles(mediaFiles)
	return nil
}

func (w *Walker) removeDeletedMediaFilesByMetaDataId(id float64) {
	ctx := context.Background()
	// get all media files by meta data id
	mediaFiles, err := m.MediaFiles(
		qm.Where("metaDataId = ?", id),
	).All(ctx, db.DB)
	if err != nil {
		log.Println("could not get media files by meta data id", err)
		return
	}
	w.removeDeletedMediaFiles(mediaFiles)
}

func (w *Walker) removeDeletedMediaFiles(mediaFiles []*m.MediaFile) {
	// delete all media files that are not in the file system
	count := 0
	for _, mediaFile := range mediaFiles {

		// check if file not exists
		if _, err := os.Stat(mediaFile.Path.String); os.IsNotExist(err) {
			ctx := context.Background()
			_, err = mediaFile.Delete(ctx, db.DB)
			if err == nil {
				count++
			}
		}
	}
	log.Printf("Deleted [%d] files removed", count)
}

func (w *Walker) Sweep(paths []string) {
	// Recover from any panic deep in the sweep pipeline (TMDB lookups,
	// sqlite writes, ptn parser, etc). Without this a single bad file
	// crashes the whole process because Sweep / FullSweep are launched
	// with bare `go ...` from main.go and the cron scheduler.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in Sweep: %v\n%s", r, debug.Stack())
			w.server.BroadcastMessage(fmt.Sprintf("Sweep crashed: %v", r))
		}
	}()

	endMsg := "Sweep done"

	// read from file system, accumulate all files
	entries := w.GetEntriesFromPaths(paths)
	if entries == nil || len(entries) == 0 {
		w.releaseLock("No files found in sweep. " + endMsg)
		return
	}

	// insert into db (not duplicates)
	w.insertMediaFilesToDB(entries)

	ctx := context.Background()
	// get all missing metadata for files and query TMDB
	filesWithoutMetaData, err := m.MediaFiles(qm.Where(`metaDataId IS NULL`)).All(ctx, db.DB)
	if err != nil {
		w.releaseLock("No files without metadata found, skipping net search")
		return
	}

	tmdbClient := w.tmdbClient
	totalFiles := len(filesWithoutMetaData)
	for i, file := range filesWithoutMetaData {
		gtmdb.GetMetaDataAndSaveToDB(file, tmdbClient, w.server, i, totalFiles)
	}
	// NOTE: no "reload" broadcast here. Callers are responsible for
	// rebuilding feed snapshots and broadcasting reload AFTER this returns
	// (see fsnotify callback and FullSweep) so the UI re-fetches against
	// fresh feed tables instead of the stale pre-sweep snapshot.
}

func (w *Walker) FullSweep() {
	// Outermost recover: registered FIRST so it runs LAST in LIFO defer
	// order. The releaseLock defer below still fires before this, so the
	// sweep.lock file is cleaned up. We then swallow the panic so the
	// process doesn't exit (FullSweep runs in a bare `go` goroutine from
	// the systray menu and cron scheduler).
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in FullSweep: %v\n%s", r, debug.Stack())
			w.server.BroadcastMessage(fmt.Sprintf("FullSweep crashed: %v", r))
		}
	}()

	endMsg := "Sweep done"
	if checkIfSweepIsRunning() {
		w.server.BroadcastMessage("Sweep already running")
		return
	}
	defer w.releaseLock(endMsg)

	log.Println("Starting full sweep")
	w.server.BroadcastMessage("Starting full sweep")

	w.Sweep(w.walkDirArr)

	// remove deleted files from db
	err := w.removeAllDeletedMediaFiles()
	if err != nil {
		log.Println("Error removing deleted files", err)
	}

	// generate genres
	_, err = w.server.ReprocessGenres()
	if err != nil {
		log.Println("Error reprocessing genres", err)
	} else {
		log.Println("Genres reprocessed")
	}

	// Refresh materialised feed snapshots so the next GetMedia request hits
	// fresh aggregates without paying the GROUP BY cost on the read path.
	// Must run BEFORE the reload broadcast so the browser re-fetches against
	// the new feed tables instead of the stale pre-sweep snapshot.
	db.RebuildFeeds()
	w.server.BroadcastMessage("reload")
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

	log.Println("start adding files to db")

	ctx := context.Background()
	// get all files from files
	files, err := m.MediaFiles(qm.Select("id", "hash", "path")).All(ctx, db.DB)
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
		err := entry.Insert(ctx, db.DB, boil.Infer())
		if err != nil {
			skippedFiles++
		} else {
			addedFiles++
		}
		log.Printf("\rskipped files: %d, added: %d", skippedFiles, addedFiles)
	}
	log.Printf("\ndone adding files to db %d \n", addedFiles)
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
		if !info.IsDir() && hasValidExtension(info.Name(), includeExtensions) {
			tor, err := ptnutil.SafeParse(info.Name())
			if err != nil {
				log.Printf("Error parsing torrent name %q: %v", info.Name(), err)
				return nil
			}

			fmt.Sprintf("scanning name: %s", tor.Title)
			//log.Printf("scanning name: %s\n", tor.Title)

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
			// log.Println("Torrent name: ", string(torJson))

			// print the number of torrents to console without adding a newline
			//log.Printf("\rNumber of torrents found: %d", len(result))
			str := fmt.Sprintf("searching media files... found: %d", len(result))
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
		log.Printf("Error walking the path %q: %v\n", dir, err)
		w.server.BroadcastMessage(fmt.Sprintf("Error walking the path %q: %v", dir, err))
		return nil, err
	}

	// print the number of torrents found
	log.Println("\rNumber of files found: ", len(result))
	w.server.BroadcastMessage(fmt.Sprintf("total files found: %d", len(result)))
	return result, nil
}

func checkIfSweepIsRunning() bool {

	// check if sweep is already running
	if _, err := os.Stat("sweep.lock"); err == nil {
		log.Println("Sweep already running")
		return true
	}
	// create a lock file
	_, err := os.Create("sweep.lock")
	if err != nil {
		log.Println("Error creating lock file")
	}

	return false
}

func stringInSlice(haystack string, needles []string) bool {
	for _, needle := range needles {
		// Use regexp to find whole word matches
		pattern := fmt.Sprintf(`\b%s\b`, regexp.QuoteMeta(needle))
		re := regexp.MustCompile(pattern)
		if re.MatchString(haystack) {
			return true
		}
	}
	//for _, e := range extensions {
	//	if strings.Contains(strings.ToLower(str), e) {
	//		return true
	//	}
	//}
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

	ctx := context.Background()
	md, err := m.MetaData().One(ctx, db.DB)
	if err != nil {
		// create a new metadata
		md = &m.MetaDatum{
			Title: null.StringFrom(tor.Title),
			Type:  null.StringFrom(string(t)),
		}
		// get the meta data from the internet
		//md = getMetaDataFromInternetByMediaFile(md)
		_ = md.Insert(ctx, db.DB, boil.Infer())
	} else {
		mf.MetaDataId = md.ID
		if t == Series {
			episode, err := m.Episodes(
				qm.Where(`season=?`, tor.Season),
				qm.Where(`episode=?`, tor.Episode),
			).One(context.Background(), db.DB)
			if err != nil && episode != nil {
				mf.EpisodeId = episode.ID
			}
		}
	}
}

// Helper function to check if a file has a valid extension
func hasValidExtension(fileName string, extensions []string) bool {
	for _, ext := range extensions {
		if strings.HasSuffix(strings.ToLower(fileName), ext) {
			return true
		}
	}
	return false
}
