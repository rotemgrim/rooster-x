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
	"io"
	"log"
	"net/http"
	url2 "net/url"
	"regexp"
	"strconv"
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
	Score float64
	Votes int64
}

func GetImdbRatingsFromImdb(imdbId string) (ImdbRating, error) {
	url := fmt.Sprintf("https://www.imdb.com/title/%s/", imdbId)

	// Create a new request
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		log.Println("Error creating request:", err)
		return ImdbRating{}, err
	}

	// Set the User-Agent header
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")

	// Perform the request
	client := &http.Client{}
	response, err := client.Do(req)
	if err != nil {
		log.Println("Error fetching imdb page:", err)
		return ImdbRating{}, err
	}
	defer response.Body.Close()

	text, err := io.ReadAll(response.Body)
	if err != nil {
		log.Println("Error reading imdb page:", err)
		return ImdbRating{}, err
	}

	//log.Printf("imdb url %s\n", url)
	//log.Printf("response text for imdb %s\n", text)

	ratingValuePattern := regexp.MustCompile(`"aggregateRating":\{"@type":"AggregateRating".*?"ratingValue":(\d+(\.\d+)?)`)
	ratingCountPattern := regexp.MustCompile(`"aggregateRating":\{"@type":"AggregateRating".*?"ratingCount":(\d+)`)

	// Find matches
	ratingValueMatch := ratingValuePattern.FindStringSubmatch(string(text))
	ratingCountMatch := ratingCountPattern.FindStringSubmatch(string(text))

	// Extract values if matches are found
	var ratingValue, ratingCount string
	if len(ratingValueMatch) > 1 {
		ratingValue = ratingValueMatch[1]
	}
	if len(ratingCountMatch) > 1 {
		ratingCount = ratingCountMatch[1]
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
		Score: score,
		Votes: votes,
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

	// Get the ratings
	rating, err := GetImdbRatingsFromImdb(metaData.ImdbId.String)
	if err != nil {
		// update the movie with the rating
		metaData.Rating = null.Float64From(-2)
		metaData.Votes = null.Int64From(-2)
		_, err = metaData.Update(ctx, db.DB, boil.Whitelist("rating", "votes"))
		if err != nil {
			log.Println("Error updating metaData with imdb rating:", err)
		}
		return
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
