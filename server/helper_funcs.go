package server

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"github.com/volatiletech/sqlboiler/v4/queries/qm"
	"go-poc/db"
	m "go-poc/models"
	"go-poc/torrents/tpb"
	"io"
	"log"
	"net/http"
	url2 "net/url"
	"regexp"
	"strconv"
	"strings"
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
	response, err := http.Get(url)
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

	resp, err := http.Get(url)
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

func GetImdbRatingsFromImdb(imdbId string) (ImdbRating, error) {
	imdbUrl := fmt.Sprintf("https://www.imdb.com/title/%s/", imdbId)

	// Use chromedp (headless browser) to bypass AWS WAF JavaScript challenge
	log.Printf("Fetching IMDB rating for %s using chromedp", imdbId)
	ctx := context.Background()
	html, err := tpb.FetchWaitFor(ctx, imdbUrl, `script[type="application/ld+json"]`, 30*time.Second)
	if err != nil {
		log.Printf("Error fetching IMDB page with chromedp for %s: %v", imdbId, err)
		return ImdbRating{}, err
	}

	log.Printf("IMDB chromedp response length for %s: %d", imdbId, len(html))

	return parseImdbRating(imdbId, html)
}

func parseImdbRating(imdbId string, html string) (ImdbRating, error) {
	ratingValuePattern := regexp.MustCompile(`"aggregateRating":\{"@type":"AggregateRating".*?"ratingValue":(\d+(\.\d+)?)`)
	ratingCountPattern := regexp.MustCompile(`"aggregateRating":\{"@type":"AggregateRating".*?"ratingCount":(\d+)`)

	// Find matches
	ratingValueMatch := ratingValuePattern.FindStringSubmatch(html)
	ratingCountMatch := ratingCountPattern.FindStringSubmatch(html)

	// Extract values if matches are found
	var ratingValue, ratingCount string
	if len(ratingValueMatch) > 1 {
		ratingValue = ratingValueMatch[1]
	} else {
		log.Printf("IMDB rating value not found for %s, response length: %d", imdbId, len(html))
		return ImdbRating{}, fmt.Errorf("rating value not found in IMDB page for %s", imdbId)
	}
	if len(ratingCountMatch) > 1 {
		ratingCount = ratingCountMatch[1]
	} else {
		log.Printf("IMDB rating count not found for %s", imdbId)
	}

	score, err := strconv.ParseFloat(ratingValue, 63)
	if err != nil {
		score = -1
	}

	votes, err := strconv.ParseInt(ratingCount, 10, 64)
	if err != nil {
		votes = -1
	}

	return ImdbRating{
		Score:  score,
		Votes:  votes,
		Source: "imdb",
	}, nil
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
