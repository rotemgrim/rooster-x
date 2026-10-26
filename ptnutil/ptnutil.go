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
