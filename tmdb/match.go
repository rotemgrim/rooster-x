package gtmdb

import (
	"strconv"
	"strings"
	"unicode"

	tmdb "github.com/cyruzin/golang-tmdb"
)

// candidate is a TMDB search result reduced to what choosing between them needs.
type candidate struct {
	id    int64
	names []string
}

func seriesCandidates(res *tmdb.SearchTVShows) []candidate {
	var out []candidate
	for _, r := range res.Results {
		out = append(out, candidate{r.ID, []string{r.Name, r.OriginalName}})
	}
	return out
}

func movieCandidates(res *tmdb.SearchMovies) []candidate {
	var out []candidate
	for _, r := range res.Results {
		out = append(out, candidate{r.ID, []string{r.Title, r.OriginalTitle}})
	}
	return out
}

// normalizeTitle lowercases a title and drops everything but its letters and
// digits, so "Marvel's Agents of S.H.I.E.L.D." equals "marvels agents of shield".
func normalizeTitle(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// pickCandidate returns the id of the result named like title, or of the first
// result when none is, leaving out the show exclude. TMDB's search also matches
// alternative titles, so its first result is often some other show. It returns 0
// when no result is left.
func pickCandidate(title string, exclude int64, cands []candidate) int64 {
	want := normalizeTitle(title)
	var first int64
	for _, c := range cands {
		if c.id == exclude {
			continue
		}
		if first == 0 {
			first = c.id
		}
		for _, n := range c.names {
			if want != "" && normalizeTitle(n) == want {
				return c.id
			}
		}
	}
	return first
}

// searchKey is the key of a search in the caches: the same title searched for
// another year has other results.
func searchKey(title string, year int) string {
	return title + "|" + strconv.Itoa(year)
}
