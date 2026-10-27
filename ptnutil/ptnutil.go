// Package ptnutil wraps github.com/middelink/go-parse-torrent-name with a
// panic-safe shim. The upstream parser is unmaintained and panics on a
// number of real-world filenames (e.g. "slice bounds out of range [16:7]"
// triggered by certain release names). Those panics used to take down the
// whole sweep / app. SafeParse converts any panic from Parse into a normal
// error so callers' existing "skip this file" path runs.
package ptnutil

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	ptn "github.com/middelink/go-parse-torrent-name"
)

// longEpisode matches S01E100 / 1x100. The upstream episode pattern takes
// exactly two digits, so episodes past 99 come back as 0.
var longEpisode = regexp.MustCompile(`(?i)\bs?([0-9]{1,2})[ex]([0-9]{3,4})(?:[^0-9]|$)`)

// SafeParse calls ptn.Parse and recovers from any panic, returning it as
// an error instead. It also reads three- and four-digit episode numbers,
// which ptn.Parse misses.
func SafeParse(name string) (info *ptn.TorrentInfo, err error) {
	defer func() {
		if r := recover(); r != nil {
			info = nil
			err = fmt.Errorf("ptn.Parse panicked on %q: %v", name, r)
		}
	}()
	info, err = ptn.Parse(name)
	if err != nil {
		return info, err
	}
	if m := longEpisode.FindStringSubmatch(strings.ReplaceAll(name, "_", " ")); m != nil {
		info.Season, _ = strconv.Atoi(m[1])
		info.Episode, _ = strconv.Atoi(m[2])
	}
	return info, nil
}

// The folders named for their season: "Season 2", and just "S02".
var seasonFolders = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bseason[ ._-]?([0-9]{1,2})\b`),
	regexp.MustCompile(`(?i)^s([0-9]{1,2})$`),
}

// Season reads the season of an episode file from its path: "S02E05" or
// "2x05" in its name, else the nearest "Season 2" or "S02" folder; 0 if it
// has none. The name's season counts only with an episode beside it, as
// without one upstream reads a resolution like 1920x1080 as season 20.
func Season(path string) int {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return 0
	}
	if info, err := SafeParse(parts[len(parts)-1]); err == nil && info.Episode > 0 && info.Season > 0 {
		return info.Season
	}
	for i := len(parts) - 2; i >= 0; i-- {
		for _, folder := range seasonFolders {
			if m := folder.FindStringSubmatch(parts[i]); m != nil {
				n, _ := strconv.Atoi(m[1])
				return n
			}
		}
	}
	return 0
}
