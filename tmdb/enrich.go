package gtmdb

import (
	"context"
	"encoding/json"
	"fmt"
	"go-poc/db"
	m "go-poc/models"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
)

// Package-level client used by enrichment routines. Set once at startup.
var enrichmentClient *tmdb.Client

// SetEnrichmentClient stores the shared TMDB client used by enrichment.
func SetEnrichmentClient(c *tmdb.Client) {
	enrichmentClient = c
}

// Broadcaster is optional. When set, enrichment routines will emit
// status messages to all connected WS clients (e.g. browser toasts).
var enrichmentBroadcaster func(msg string)

// SetEnrichmentBroadcaster installs a callback used to notify the UI.
func SetEnrichmentBroadcaster(fn func(msg string)) {
	enrichmentBroadcaster = fn
}

// LifecycleHooks are optional callbacks fired when a sweep starts and
// finishes (used by main.go to swap the tray icon).
var (
	enrichmentOnStart func()
	enrichmentOnDone  func()
)

// SetEnrichmentLifecycle installs optional start/done hooks.
func SetEnrichmentLifecycle(onStart, onDone func()) {
	enrichmentOnStart = onStart
	enrichmentOnDone = onDone
}

func broadcast(msg string) {
	if enrichmentBroadcaster != nil {
		enrichmentBroadcaster(msg)
	}
}

// updateWithRetry persists a metadata row, retrying briefly on transient
// SQLite errors (e.g. SQLITE_BUSY). Without this a single locked write
// would leave the row at enrichState=NULL and cause it to be re-queried
// on the next sweep, wasting a TMDB call.
func updateWithRetry(ctx context.Context, md *m.MetaDatum) error {
	const maxAttempts = 5
	var lastErr error
	delay := 100 * time.Millisecond
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if _, err := md.Update(ctx, db.DB, boil.Infer()); err != nil {
			lastErr = err
			low := strings.ToLower(err.Error())
			if !strings.Contains(low, "locked") && !strings.Contains(low, "busy") {
				return err
			}
			time.Sleep(delay)
			delay *= 2
			continue
		}
		return nil
	}
	return lastErr
}

// trackedFieldsMissing returns true if any of the tracked metadata fields
// is missing on the row, meaning enrichment would actually produce changes.
func trackedFieldsMissing(md *m.MetaDatum) bool {
	if !md.Tagline.Valid || md.Tagline.String == "" {
		return true
	}
	if !md.Backdrop.Valid || md.Backdrop.String == "" {
		return true
	}
	if !md.ProductionStatus.Valid || md.ProductionStatus.String == "" {
		return true
	}
	if !md.AgeRating.Valid || md.AgeRating.String == "" {
		return true
	}
	if !md.Network.Valid || md.Network.String == "" {
		return true
	}
	if !md.Director.Valid || md.Director.String == "" {
		return true
	}
	if !md.Writer.Valid || md.Writer.String == "" {
		return true
	}
	if !md.Actors.Valid || md.Actors.String == "" {
		return true
	}
	if !md.Country.Valid || md.Country.String == "" {
		return true
	}
	if !md.Plot.Valid || md.Plot.String == "" {
		return true
	}
	if !md.Poster.Valid || md.Poster.String == "" {
		return true
	}
	if !md.Runtime.Valid || md.Runtime.Int64 == 0 {
		return true
	}
	if !md.Year.Valid || md.Year.Int64 == 0 {
		return true
	}
	if !md.Released.Valid || md.Released.String == "" {
		return true
	}
	return false
}

// applyTVDetailsToMeta overwrites tracked fields on md from the TMDB TV
// details response. Returns the genre list extracted from the response.
func applyTVDetailsToMeta(md *m.MetaDatum, d *tmdb.TVDetails) []string {
	if d.Name != "" {
		md.Title = null.StringFrom(d.Name)
	}
	if d.PosterPath != "" {
		md.Poster = null.StringFrom(d.PosterPath)
	}
	md.Type = null.StringFrom("series")
	md.Series = null.BoolFrom(true)

	var genres []string
	for _, g := range d.Genres {
		genres = append(genres, g.Name)
	}

	if d.TVExternalIDs != nil && d.TVExternalIDs.IMDbID != "" {
		md.ImdbId = null.StringFrom(d.TVExternalIDs.IMDbID)
	}
	md.TMDBID = null.Int64From(d.ID)

	if d.FirstAirDate != "" {
		if y, err := strconv.ParseInt(strings.Split(d.FirstAirDate, "-")[0], 10, 64); err == nil {
			md.Year = null.Int64From(y)
		}
		md.Released = null.StringFrom(d.FirstAirDate)
		if t, err := time.Parse("2006-01-02", d.FirstAirDate); err == nil {
			md.ReleasedUnix = null.Int64From(t.Unix())
		}
	}

	if d.Overview != "" {
		md.Plot = null.StringFrom(d.Overview)
	}
	if len(d.CreatedBy) > 0 {
		md.Director = null.StringFrom(d.CreatedBy[0].Name)
	}

	if d.Credits.TVCredits != nil {
		var actors []string
		for _, a := range d.Credits.Cast {
			actors = append(actors, a.Name)
		}
		if len(actors) > 0 {
			md.Actors = null.StringFrom(strings.Join(actors, ","))
		}
	}

	if len(d.OriginCountry) > 0 {
		md.Country = null.StringFrom(strings.Join(d.OriginCountry, ","))
	}

	type netEntry struct {
		Name string `json:"name"`
		Logo string `json:"logo,omitempty"`
	}
	var nets []netEntry
	for _, n := range d.Networks {
		if n.Name != "" {
			nets = append(nets, netEntry{Name: n.Name, Logo: n.LogoPath})
		}
	}
	if len(nets) > 0 {
		if jb, err := json.Marshal(nets); err == nil {
			md.Network = null.StringFrom(string(jb))
		}
	}

	if d.Tagline != "" {
		md.Tagline = null.StringFrom(d.Tagline)
	}
	if d.BackdropPath != "" {
		md.Backdrop = null.StringFrom(d.BackdropPath)
	}
	if d.Status != "" {
		md.ProductionStatus = null.StringFrom(d.Status)
	}

	if d.ContentRatings != nil && d.ContentRatings.TVContentRatingsResults != nil {
		rating := pickRating(d.ContentRatings.Results)
		if rating != "" {
			md.AgeRating = null.StringFrom(rating)
		}
	}

	return genres
}

func pickRating(results []struct {
	Iso3166_1 string `json:"iso_3166_1"`
	Rating    string `json:"rating"`
}) string {
	for _, r := range results {
		if r.Iso3166_1 == "US" && r.Rating != "" {
			return r.Rating
		}
	}
	for _, r := range results {
		if r.Rating != "" {
			return r.Rating
		}
	}
	return ""
}

// applyMovieDetailsToMeta overwrites tracked fields from a TMDB movie
// details response. Returns the genre list extracted from the response.
func applyMovieDetailsToMeta(md *m.MetaDatum, d *tmdb.MovieDetails) []string {
	if d.Title != "" {
		md.Title = null.StringFrom(d.Title)
	}
	if d.PosterPath != "" {
		md.Poster = null.StringFrom(d.PosterPath)
	}
	md.Type = null.StringFrom("movie")
	md.Series = null.BoolFrom(false)

	var genres []string
	for _, g := range d.Genres {
		genres = append(genres, g.Name)
	}

	if d.IMDbID != "" {
		md.ImdbId = null.StringFrom(d.IMDbID)
	}
	md.TMDBID = null.Int64From(d.ID)

	if d.ReleaseDate != "" {
		if y, err := strconv.ParseInt(strings.Split(d.ReleaseDate, "-")[0], 10, 64); err == nil {
			md.Year = null.Int64From(y)
		}
		md.Released = null.StringFrom(d.ReleaseDate)
		if t, err := time.Parse("2006-01-02", d.ReleaseDate); err == nil {
			md.ReleasedUnix = null.Int64From(t.Unix())
		}
	}

	if d.Overview != "" {
		md.Plot = null.StringFrom(d.Overview)
	}
	if d.Runtime > 0 {
		md.Runtime = null.Int64From(int64(d.Runtime))
	}

	if d.Credits.MovieCredits != nil {
		var actors []string
		for _, a := range d.Credits.Cast {
			actors = append(actors, a.Name)
		}
		if len(actors) > 0 {
			md.Actors = null.StringFrom(strings.Join(actors, ","))
		}

		// Director / Writer from crew
		var directors, writers []string
		for _, c := range d.Credits.Crew {
			switch c.Job {
			case "Director":
				directors = append(directors, c.Name)
			case "Screenplay", "Writer":
				writers = append(writers, c.Name)
			}
		}
		if len(directors) > 0 {
			md.Director = null.StringFrom(strings.Join(directors, ","))
		}
		if len(writers) > 0 {
			md.Writer = null.StringFrom(strings.Join(writers, ","))
		}
	}

	if len(d.OriginCountry) > 0 {
		md.Country = null.StringFrom(strings.Join(d.OriginCountry, ","))
	}

	type companyEntry struct {
		Name string `json:"name"`
		Logo string `json:"logo,omitempty"`
	}
	var companies []companyEntry
	for _, c := range d.ProductionCompanies {
		if c.Name != "" {
			companies = append(companies, companyEntry{Name: c.Name, Logo: c.LogoPath})
		}
	}
	if len(companies) > 0 {
		if jb, err := json.Marshal(companies); err == nil {
			md.Network = null.StringFrom(string(jb))
		}
	}

	if d.Tagline != "" {
		md.Tagline = null.StringFrom(d.Tagline)
	}
	if d.BackdropPath != "" {
		md.Backdrop = null.StringFrom(d.BackdropPath)
	}
	if d.Status != "" {
		md.ProductionStatus = null.StringFrom(d.Status)
	}

	if d.ReleaseDates != nil && d.ReleaseDates.MovieReleaseDatesResults != nil {
		var cert string
		for _, r := range d.ReleaseDates.Results {
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
			for _, r := range d.ReleaseDates.Results {
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
			md.AgeRating = null.StringFrom(cert)
		}
	}

	return genres
}

// EnrichOne re-fetches a metadata row from TMDB and overwrites tracked
// fields. When force is true, runs even if EnrichState='ok'/'unavailable'.
// Returns the updated row (already saved to DB).
func EnrichOne(metaDataId int64, force bool) (*m.MetaDatum, error) {
	if enrichmentClient == nil {
		return nil, fmt.Errorf("tmdb client not initialized")
	}

	ctx := context.Background()
	md, err := m.FindMetaDatum(ctx, db.DB, null.Int64From(metaDataId))
	if err != nil {
		return nil, fmt.Errorf("metadata %d not found: %w", metaDataId, err)
	}

	// Skip auto when state is set, unless forced.
	if !force {
		if md.EnrichState.Valid {
			s := md.EnrichState.String
			if s == "ok" || s == "unavailable" {
				return md, nil
			}
		}
	}

	// Need a tmdbId to do a direct lookup.
	if !md.TMDBID.Valid || md.TMDBID.Int64 == 0 {
		md.EnrichState = null.StringFrom("unavailable")
		md.EnrichedAt = null.Int64From(time.Now().Unix())
		_ = updateWithRetry(ctx, md)
		return md, fmt.Errorf("metadata %d has no tmdbId", metaDataId)
	}

	isSeries := md.Series.Valid && md.Series.Bool
	tmdbId := int(md.TMDBID.Int64)

	var genres []string
	if isSeries {
		opts := map[string]string{
			"language":           LANG,
			"append_to_response": "external_ids,genres,credits,content_ratings",
		}
		d, err := enrichmentClient.GetTVDetails(tmdbId, opts)
		if err != nil {
			return markUnavailable(md, err)
		}
		genres = applyTVDetailsToMeta(md, d)
	} else {
		opts := map[string]string{
			"language":           LANG,
			"append_to_response": "external_ids,genres,credits,release_dates",
		}
		d, err := enrichmentClient.GetMovieDetails(tmdbId, opts)
		if err != nil {
			return markUnavailable(md, err)
		}
		genres = applyMovieDetailsToMeta(md, d)
	}

	md.EnrichState = null.StringFrom("ok")
	md.EnrichedAt = null.Int64From(time.Now().Unix())

	if err := updateWithRetry(ctx, md); err != nil {
		return nil, fmt.Errorf("update failed: %w", err)
	}

	if len(genres) > 0 {
		if err := db.SaveGenresForMetaData(md.ID.Int64, genres); err != nil {
			log.Printf("Warning: could not save genres for metadata %d: %v", md.ID.Int64, err)
		}
	}

	return md, nil
}

// episodeRefreshes caps how many episodes RefreshEpisodes asks TMDB for at once.
const episodeRefreshes = 6

// hasDetails says whether an episode has the still and plot TMDB fills in once
// it knows the episode.
func hasDetails(ep *m.Episode) bool {
	return ep.Poster.String != "" && ep.Plot.String != ""
}

// RefreshEpisodes re-fetches from TMDB the series' episodes without details
// (see hasDetails), which they keep when they are scanned before TMDB has them.
// It returns how many were without and how many have them now.
func RefreshEpisodes(metaDataId int64) (missing, filled int, err error) {
	if enrichmentClient == nil {
		return 0, 0, fmt.Errorf("tmdb client not initialized")
	}
	ctx := context.Background()
	md, err := m.FindMetaDatum(ctx, db.DB, null.Int64From(metaDataId))
	if err != nil {
		return 0, 0, fmt.Errorf("metadata %d not found: %w", metaDataId, err)
	}
	if !md.TMDBID.Valid || md.TMDBID.Int64 == 0 {
		return 0, 0, fmt.Errorf("metadata %d has no tmdbId", metaDataId)
	}
	episodes, err := m.Episodes(qm.Where("metaDataId = ?", metaDataId)).All(ctx, db.DB)
	if err != nil {
		return 0, 0, fmt.Errorf("could not load episodes of %d: %w", metaDataId, err)
	}

	var (
		wg        sync.WaitGroup
		slots     = make(chan struct{}, episodeRefreshes)
		filledNow atomic.Int64
	)
	for _, ep := range episodes {
		if hasDetails(ep) {
			continue
		}
		missing++
		wg.Add(1)
		go func() {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			if refreshEpisode(ctx, md, ep) {
				filledNow.Add(1)
			}
		}()
	}
	wg.Wait()
	return missing, int(filledNow.Load()), nil
}

// refreshEpisode fetches ep of the series md from TMDB and saves it, and says
// whether it has its details now.
func refreshEpisode(ctx context.Context, md *m.MetaDatum, ep *m.Episode) bool {
	season, episode := int(ep.Season.Int64), int(ep.Episode.Int64)
	d, err := enrichmentClient.GetTVEpisodeDetails(int(md.TMDBID.Int64), season, episode, map[string]string{"language": LANG})
	if err != nil {
		log.Printf("could not refresh %s S%02dE%02d: %v", md.Title.String, season, episode, err)
		return false
	}
	applyEpisodeDetails(ep, d)
	if _, err := ep.Update(ctx, db.DB, boil.Infer()); err != nil {
		log.Printf("could not save %s S%02dE%02d: %v", md.Title.String, season, episode, err)
		return false
	}
	return hasDetails(ep)
}

func markUnavailable(md *m.MetaDatum, cause error) (*m.MetaDatum, error) {
	ctx := context.Background()
	md.EnrichState = null.StringFrom("unavailable")
	md.EnrichedAt = null.Int64From(time.Now().Unix())
	_ = updateWithRetry(ctx, md)
	return md, fmt.Errorf("tmdb fetch failed: %w", cause)
}

// RunEnrichmentSweep iterates rows that need enrichment and processes them.
// limit caps how many rows are touched per invocation. Rate-limits with a
// short sleep between TMDB calls.
// sweepMu guards against overlapping sweeps (cron + manual tray click).
var sweepMu sync.Mutex

func RunEnrichmentSweep(limit int) {
	if enrichmentClient == nil {
		log.Println("enrichment sweep: tmdb client not initialized; skipping")
		return
	}
	if !sweepMu.TryLock() {
		log.Println("enrichment sweep: already running; skipping this invocation")
		broadcast("Enrichment already running; ignored")
		return
	}
	defer sweepMu.Unlock()

	if limit <= 0 {
		limit = 200
	}

	if enrichmentOnStart != nil {
		enrichmentOnStart()
	}
	defer func() {
		if enrichmentOnDone != nil {
			enrichmentOnDone()
		}
	}()

	ctx := context.Background()
	rows, err := m.MetaData(
		qm.Where("(enrichState IS NULL OR enrichState = ?)", "needed"),
		qm.Where("tmdbId IS NOT NULL"),
		qm.OrderBy("id DESC"), // newest first
		qm.Limit(limit),
	).All(ctx, db.DB)
	if err != nil {
		log.Printf("enrichment sweep: query failed: %v", err)
		return
	}

	// Keep only rows that actually have something missing; mark the rest 'ok'.
	var toProcess []*m.MetaDatum
	skipped := 0
	for _, md := range rows {
		if !trackedFieldsMissing(md) {
			md.EnrichState = null.StringFrom("ok")
			md.EnrichedAt = null.Int64From(time.Now().Unix())
			_ = updateWithRetry(ctx, md)
			skipped++
			continue
		}
		toProcess = append(toProcess, md)
	}

	if len(toProcess) == 0 {
		if skipped > 0 {
			log.Printf("enrichment sweep: no rows needed enrichment (%d already complete, marked ok)", skipped)
			broadcast(fmt.Sprintf("Enrichment: nothing to do (%d already complete)", skipped))
		} else {
			log.Println("enrichment sweep: no rows needed enrichment")
			broadcast("Enrichment: nothing to do")
		}
		return
	}

	log.Printf("enrichment sweep: %d rows queued (skipped %d already-complete)", len(toProcess), skipped)
	broadcast(fmt.Sprintf("Enrichment started: %d titles to refresh", len(toProcess)))

	ok, fail := 0, 0
	for i, md := range toProcess {
		if _, err := EnrichOne(md.ID.Int64, false); err != nil {
			fail++
			log.Printf("enrichment sweep [%d/%d] id=%d failed: %v", i+1, len(toProcess), md.ID.Int64, err)
		} else {
			ok++
		}
		// Progress update on every row.
		broadcast(fmt.Sprintf("Enrichment: %d/%d (updated=%d failed=%d)", i+1, len(toProcess), ok, fail))
		// Rate-limit: TMDB allows ~40 req/10s.
		time.Sleep(250 * time.Millisecond)
	}

	if skipped > 0 {
		log.Printf("enrichment sweep: done. updated=%d failed=%d skipped=%d", ok, fail, skipped)
		broadcast(fmt.Sprintf("Enrichment done: %d updated, %d failed, %d skipped (already complete)", ok, fail, skipped))
	} else {
		log.Printf("enrichment sweep: done. updated=%d failed=%d", ok, fail)
		broadcast(fmt.Sprintf("Enrichment done: %d updated, %d failed", ok, fail))
	}
}
