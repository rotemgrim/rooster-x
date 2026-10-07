// Package ptnutil wraps github.com/middelink/go-parse-torrent-name with a
// panic-safe shim. The upstream parser is unmaintained and panics on a
// number of real-world filenames (e.g. "slice bounds out of range [16:7]"
// triggered by certain release names). Those panics used to take down the
// whole sweep / app. SafeParse converts any panic from Parse into a normal
// error so callers' existing "skip this file" path runs.
package ptnutil

import (
	"fmt"

	ptn "github.com/middelink/go-parse-torrent-name"
)

// SafeParse calls ptn.Parse and recovers from any panic, returning it as
// an error instead. Behaves exactly like ptn.Parse on the happy path.
func SafeParse(name string) (info *ptn.TorrentInfo, err error) {
	defer func() {
		if r := recover(); r != nil {
			info = nil
			err = fmt.Errorf("ptn.Parse panicked on %q: %v", name, r)
		}
	}()
	return ptn.Parse(name)
}
