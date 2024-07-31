package walker

import (
	"fmt"
	ptn "github.com/middelink/go-parse-torrent-name"
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

func FullSweep() ([]*ptn.TorrentInfo, error) {

	if checkIfSweepIsRunning() {
		return nil, nil
	}
	defer os.Remove("sweep.lock")

	fmt.Println("Starting full sweep")

	videos, err := getTorrents(dir)
	if err != nil {
		fmt.Println("Error getting torrents")
		return nil, err
	}

	return videos, nil
}

func getTorrents(dir string) ([]*ptn.TorrentInfo, error) {
	var result []*ptn.TorrentInfo

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

			result = append(result, tor)
		}

		return nil
	})
	if err != nil {
		fmt.Printf("Error walking the path")
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
