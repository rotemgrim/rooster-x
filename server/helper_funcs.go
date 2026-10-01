package server

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/db"
	m "go-poc/models"
	"io"
	"log"
	"net/http"
	"os"
	url2 "net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

func transmitPromiseResponse(c *websocket.Conn, req PayloadRequest, data interface{}) {
	response := PayloadResponse{
		ReplyChannel: req.ReplyChannel,
		Status:       StatusSuccess,
		Data:         data,
	}
	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling result:", err)
		return
	}
	err = c.WriteMessage(websocket.TextMessage, jsonResult)
	if err != nil {
		log.Println("Error writing message:", err)
	}
}

func transmitPromiseChunk(c *websocket.Conn, req PayloadRequest, data interface{}) error {
	response := PayloadResponse{
		ReplyChannel: req.ReplyChannel,
		Status:       StatusChunk,
		Data:         data,
	}
	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling chunk:", err)
		return err
	}
	err = c.WriteMessage(websocket.TextMessage, jsonResult)
	if err != nil {
		log.Println("Error writing chunk message:", err)
	}
	return err
}

func transmitPromiseReject(c *websocket.Conn, req PayloadRequest, data interface{}) {
	response := PayloadResponse{
		ReplyChannel: req.ReplyChannel,
		Status:       StatusFailure,
		Data:         data,
	}
	jsonResult, err := json.Marshal(response)
	if err != nil {
		log.Println("Error marshalling result:", err)
		return
	}
	err = c.WriteMessage(websocket.TextMessage, jsonResult)
	if err != nil {
		log.Println("Error writing message:", err)
	}
}

func GetYouTubeTrailer(title string, year int) (string, error) {
	// escape special characters
	query := url2.QueryEscape(fmt.Sprintf("%s+%d+trailer", title, year))
	url := fmt.Sprintf("https://www.youtube.com/results?search_query=%s", query)

	// get the page with fetch
	response, err := apiHttpClient.Get(url)
	if err != nil {
		log.Println("Error fetching youtube page:", err)
		return "", err
	}
	defer response.Body.Close()

	// convert to string
	text, err := io.ReadAll(response.Body)
	if err != nil {
		log.Println("Error reading youtube page:", err)
		return "", err
	}

	//log.Printf("response url %s", url)
	//log.Printf("response text for trailer %s", text)

	// do the same with go
	regex := regexp.MustCompile(`"videoId":"(.*?)"`)
	match := regex.FindStringSubmatch(string(text))
	if len(match) < 2 {
		log.Println("No Youtube trailer found")
		return "", fmt.Errorf("No Youtube trailer found")
	}
	return fmt.Sprintf("https://www.youtube.com/watch?v=%s", match[1]), nil
}

// apiHttpClient is used for small API/page requests so a stalled server can't hang a handler forever.
var apiHttpClient = &http.Client{Timeout: 15 * time.Second}

type ImdbRating struct {
	Score  float64
	Votes  int64
	Source string
}

var tmdbApiKey string

func SetTmdbApiKey(key string) {
	tmdbApiKey = key
}

var xtreamUsername, xtreamPassword, xtreamServer string

func SetXtreamConfig(username, password, server string) {
	xtreamUsername = username
	xtreamPassword = password
	xtreamServer = strings.TrimRight(server, "/")
}

type TMDBFindResponse struct {
	MovieResults []struct {
		ID          int64   `json:"id"`
		VoteAverage float64 `json:"vote_average"`
		VoteCount   int64   `json:"vote_count"`
	} `json:"movie_results"`
	TVResults []struct {
		ID          int64   `json:"id"`
		VoteAverage float64 `json:"vote_average"`
		VoteCount   int64   `json:"vote_count"`
	} `json:"tv_results"`
}

func GetRatingsFromTMDB(imdbId string) (ImdbRating, error) {
	if tmdbApiKey == "" {
		return ImdbRating{}, fmt.Errorf("TMDB API key not set")
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/find/%s?api_key=%s&external_source=imdb_id", imdbId, tmdbApiKey)

	resp, err := apiHttpClient.Get(url)
	if err != nil {
		return ImdbRating{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return ImdbRating{}, fmt.Errorf("TMDB API returned status %d", resp.StatusCode)
	}

	var result TMDBFindResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ImdbRating{}, err
	}

	// Check movie results first
	if len(result.MovieResults) > 0 {
		return ImdbRating{
			Score:  result.MovieResults[0].VoteAverage,
			Votes:  result.MovieResults[0].VoteCount,
			Source: "tmdb",
		}, nil
	}

	// Check TV results
	if len(result.TVResults) > 0 {
		return ImdbRating{
			Score:  result.TVResults[0].VoteAverage,
			Votes:  result.TVResults[0].VoteCount,
			Source: "tmdb",
		}, nil
	}

	return ImdbRating{}, fmt.Errorf("no results found in TMDB for %s", imdbId)
}

const (
	imdbRatingsUrl    = "https://datasets.imdbws.com/title.ratings.tsv.gz"
	imdbRatingsFile   = "imdb_ratings.tsv.gz"
	imdbRatingsMaxAge = 24 * time.Hour
)

var imdbRatingsMu sync.Mutex

// ensureImdbRatingsFile downloads IMDb's official ratings dataset (refreshed daily
// by IMDb) when the local copy is missing or older than a day. The imdb.com pages
// sit behind an AWS WAF captcha, so scraping them no longer works.
func ensureImdbRatingsFile() error {
	return downloadImdbRatings(false)
}

// RefreshImdbRatings re-downloads the IMDb ratings dataset regardless of its age.
// Scheduled daily so lookups never have to wait on the download.
func RefreshImdbRatings() {
	if err := downloadImdbRatings(true); err != nil {
		log.Println("Error refreshing IMDb ratings dataset:", err)
	}
}

func downloadImdbRatings(force bool) error {
	imdbRatingsMu.Lock()
	defer imdbRatingsMu.Unlock()

	if info, err := os.Stat(imdbRatingsFile); !force && err == nil && time.Since(info.ModTime()) < imdbRatingsMaxAge {
		return nil
	}

	log.Println("Downloading IMDb ratings dataset")
	client := http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Get(imdbRatingsUrl)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("IMDb dataset returned status %d", resp.StatusCode)
	}

	tmp := imdbRatingsFile + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, imdbRatingsFile)
}

// GetImdbRatingsFromImdb looks up a title in the IMDb ratings dataset.
// A full scan of the ~1.7M rows takes around 100ms.
func GetImdbRatingsFromImdb(imdbId string) (ImdbRating, error) {
	if err := ensureImdbRatingsFile(); err != nil {
		// a stale copy is still better than nothing
		if _, statErr := os.Stat(imdbRatingsFile); statErr != nil {
			return ImdbRating{}, err
		}
		log.Println("Could not refresh IMDb ratings dataset, using existing copy:", err)
	}

	f, err := os.Open(imdbRatingsFile)
	if err != nil {
		return ImdbRating{}, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return ImdbRating{}, err
	}
	defer gz.Close()

	prefix := imdbId + "	"
	scanner := bufio.NewScanner(gz)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		// tconst 	 averageRating 	 numVotes
		fields := strings.Split(line, "	")
		if len(fields) < 3 {
			break
		}
		score, err := strconv.ParseFloat(fields[1], 64)
		if err != nil {
			return ImdbRating{}, err
		}
		votes, err := strconv.ParseInt(fields[2], 10, 64)
		if err != nil {
			return ImdbRating{}, err
		}
		return ImdbRating{Score: score, Votes: votes, Source: "imdb"}, nil
	}
	if err := scanner.Err(); err != nil {
		return ImdbRating{}, err
	}
	return ImdbRating{}, fmt.Errorf("%s not found in IMDb ratings dataset", imdbId)
}

func ImdbRatingPoll() {
	// Get all movies without imdb ratings
	ctx := context.Background()
	metaData, err := m.MetaData(
		qm.Where("imdbId IS NOT NULL AND rating IS NULL"),
		qm.OrderBy("id DESC"),
	).One(ctx, db.DB)
	if err != nil {
		return
	}

	// Try IMDB first, then fall back to TMDB
	rating, err := GetImdbRatingsFromImdb(metaData.ImdbId.String)
	if err != nil || rating.Score < 0 {
		log.Printf("IMDB failed for %s, trying TMDB fallback", metaData.ImdbId.String)
		rating, err = GetRatingsFromTMDB(metaData.ImdbId.String)
		if err != nil {
			log.Printf("TMDB fallback also failed for %s: %v", metaData.ImdbId.String, err)
			metaData.Rating = null.Float64From(-2)
			metaData.Votes = null.Int64From(-2)
			_, err = metaData.Update(ctx, db.DB, boil.Whitelist("rating", "votes"))
			if err != nil {
				log.Println("Error updating metaData with rating:", err)
			}
			return
		}
	}

	// Update the movie with the rating
	metaData.Rating = null.Float64From(rating.Score)
	metaData.Votes = null.Int64From(rating.Votes)
	_, err = metaData.Update(ctx, db.DB, boil.Whitelist("rating", "votes"))
	if err != nil {
		log.Println("Error updating movie with imdb rating:", err)
		return
	}

	log.Println("Updated metaData with imdb rating for:", metaData.Title.String, "rating:", rating.Score, "votes:", rating.Votes)
}
