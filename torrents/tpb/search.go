package tpb

import (
	"context"
	"fmt"
	"github.com/juliensalinas/torrengo/core"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"log"
)

// Torrent contains meta information about the torrent
type Torrent struct {
	Magnet  string
	Name    string
	Size    string
	UplDate string
	// Seeders and Leechers are converted to -1 if cannot be converted to integers
	Seeders  int
	Leechers int
}

type PBType string

const (
	Original PBType = "original"
	Proxy    PBType = "proxy"
)

type ProxyUrl struct {
	Url      string
	SiteType PBType
}

type Searches struct {
	Original []string
	Proxy    []string
}

var searches = Searches{
	Original: []string{
		"top100:48h_211", // movies trending in the last 48 hours 2160p
		"top100:48h_212", // series trending in the last 48 hours 2160p
		"top100:48h_207", // movies trending in the last 48 hours 1080p
		"top100:48h_208", // series trending in the last 48 hours 1080p
	},
	Proxy: []string{
		"/top/48h211", // movies trending in the last 48 hours 2160p
		"/top/48h212", // series trending in the last 48 hours 2160p
		"/top/48h207", // movies trending in the last 48 hours 1080p
		"/top/48h208", // series trending in the last 48 hours 1080p
	},
}

var proxyList = []ProxyUrl{
	{Url: "https://thepiratebay.org", SiteType: Original},
	//{Url: "https://thepiratebay.xyz", SiteType: Proxy},
	//{Url: "https://thepiratebay10.info", SiteType: Proxy},
	//{Url: "https://thepiratebay0.org", SiteType: Proxy},
	//{Url: "https://pirateproxylive.org", SiteType: Proxy},
	//{Url: "https://piratebayproxy.live", SiteType: Proxy},
}

// A typical final url looks like:
// baseURL + /search/dumas/0/99/0
func buildSearchURL(proxy ProxyUrl, in string) (string, error) {
	var URL *url.URL
	URL, err := url.Parse(proxy.Url)
	if err != nil {
		return "", fmt.Errorf("error during url parsing: %v", err)
	}

	if proxy.SiteType == Original {
		URL.Path += "/search.php"
		q := URL.Query()
		q.Set("q", in)
		URL.RawQuery = q.Encode()
	} else {
		URL.Path += in
	}

	return URL.String(), nil
}

func parseSearchPage(html string) ([]Torrent, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, fmt.Errorf("could not load html response into GoQuery: %v", err)
	}

	// torrents stores a list of torrents made up of the torrent description url,
	// its name, its size, its seeders, and its leechers

	//torrents := findTorrentsInHtmlProxy(doc)
	torrents := findTorrentsInHtmlOriginal(doc)

	log.Println("found torrents: ", len(torrents))
	return torrents, nil
}

// checkEmptyResp checks whether the tpb response contains the
// #torrents or #searchResult id, otherwise it means the site is broken
func checkEmptyResp(html string) bool {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		log.Println("empty html response", err)
		return false
	}

	// Check for either original site (#torrents) or proxy site (#searchResult)
	hasTorrents := doc.Find("#torrents").Nodes != nil
	hasSearchResult := doc.Find("#searchResult").Nodes != nil

	if !hasTorrents && !hasSearchResult {
		log.Println("empty torrent list in html - no #torrents or #searchResult found")
		// Debug: print first 500 chars of HTML
		if len(html) > 500 {
			log.Println("HTML preview:", html[:500])
		} else {
			log.Println("HTML preview:", html)
		}
		return false
	}

	log.Printf("Found elements - hasTorrents: %v, hasSearchResult: %v\n", hasTorrents, hasSearchResult)
	return true
}

// Lookup takes a user search as a parameter and
// returns clean torrent information fetched from ThePirateBay.
// It first looks for the ThePirateBay proxies and then
// concurrently fetches all of them and retrieve results from
// the quickest one after checking that the latter is not broken.
// A custom user timeout is set.
func Lookup(timeout time.Duration) ([]Torrent, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Create channels for communicating http response and termination
	// event in case of error.
	htmlCh := make(chan string)
	htmlErrCh := make(chan struct{})

	// For each tpb proxy, launch the same request through a new
	// goroutine.
	for _, proxy := range proxyList {

		log.Println("fetching torrents from pirate bay")

		var searchesList []string
		if proxy.SiteType == Original {
			searchesList = searches.Original
		} else {
			searchesList = searches.Proxy
		}

		for i, search := range searchesList {
			fullURL, err := buildSearchURL(proxy, search)
			if err != nil {
				continue
			}

			msg := fmt.Sprintf("Fetching torrents from pirate bay [%d/%d] %s", i, len(searchesList), search)
			log.Println(msg)

			//go fetchUrlUsingGet(ctx, fullURL, htmlCh, htmlErrCh)
			go fetchUrlUsingChromeDP(ctx, fullURL, htmlCh, htmlErrCh)
		}
	}

	var torrents []Torrent
	// From goroutines receive termination event (in case of error) or
	// http response. If http response received, it means the tpb proxy
	// worked properly and was the fastest to answer so parse results from html page
	// and leave.
	for i := 0; i < len(proxyList)*4; i++ {
		select {
		case <-htmlErrCh:
		case html := <-htmlCh:
			tmpTorrents, err := parseSearchPage(html)
			if err != nil {
				return nil, fmt.Errorf("error while parsing torrent search results: %v", err)
			}

			torrents = append(torrents, tmpTorrents...)
		}
	}

	if len(torrents) == 0 {
		return nil, fmt.Errorf("no tpb proxy working")
	}

	log.Println("found torrents: ", len(torrents))
	return torrents, nil
}

func fetchUrlUsingGet(ctx context.Context, url string, htmlCh chan string, htmlErrCh chan struct{}) {
	// fetch the html page using golang standard library
	log.Println(url)
	res, err := http.Get(url)
	if err != nil {
		log.Println("could not download page: %w", err)
		htmlErrCh <- struct{}{}
		return
	}
	defer res.Body.Close()
	content, err := io.ReadAll(res.Body)
	if err != nil {
		log.Println("cant read body for response: %w", err)
		htmlErrCh <- struct{}{}
		return
	}
	html := string(content)
	htmlCh <- html
}

func fetchUrlUsingChromeDP(ctx context.Context, url string, htmlCh chan string, htmlErrCh chan struct{}) {
	html, _, err := core.Fetch(ctx, url, nil)
	if err != nil {
		log.Println("could not download page: %w", err)
		htmlErrCh <- struct{}{}
		return
	}
	ok := checkEmptyResp(html)
	if !ok {
		log.Println("Broken proxy (code 200 but empty response)")
		htmlErrCh <- struct{}{}
		return
	}
	htmlCh <- html
}

func findTorrentsInHtmlProxy(doc *goquery.Document) []Torrent {
	var torrents []Torrent

	// Results are located in a clean list
	doc.Find("#searchResult tbody tr").Each(func(i int, s *goquery.Selection) {
		var t Torrent

		// Magnet is the href of the 4th <td> tag
		magnet, ok := s.Find("td").Eq(3).Find("a").First().Attr("href")
		if !ok {
			log.Println("Could not find a magnet for a torrent so ignoring it")
			return
		}
		t.Magnet = magnet

		// Torrent name is the text of the <td> tag in the 2nd <span>
		t.Name = s.Find("td").Eq(1).Find("a").First().Text()

		// Upload date, size, seeders, and leechers, are the text of
		// other <td> tags.
		t.UplDate = s.Find("td").Eq(2).Text()
		t.Size = s.Find("td").Eq(4).Text()

		// We convert seeders and leechers to integers and
		// conversion fails we convert it to -1.
		seedersStr := s.Find("td").Eq(5).Text()
		seedersStr = strings.TrimSpace(seedersStr)
		seeders, err := strconv.Atoi(seedersStr)

		if err != nil {
			seeders = -1
		}
		t.Seeders = seeders

		leechersStr := s.Find("td").Eq(6).Text()
		leechersStr = strings.TrimSpace(leechersStr)
		leechers, err := strconv.Atoi(leechersStr)
		if err != nil {
			leechers = -1
		}
		t.Leechers = leechers

		torrents = append(torrents, t)
	})

	return torrents
}

func findTorrentsInHtmlOriginal(doc *goquery.Document) []Torrent {
	var torrents []Torrent

	// Results are located in a clean list
	doc.Find("#torrents li").Each(func(i int, s *goquery.Selection) {
		var t Torrent
		// Magnet is the href of the 4th <a> tag
		magnet, ok := s.Find("span").Eq(3).Find("a").First().Attr("href")
		if !ok {
			log.Println("Could not find a magnet for a torrent so ignoring it")
			return
		}
		t.Magnet = magnet

		// Torrent name is the text of the <a> tag in the 2nd <span>
		t.Name = s.Find("span").Eq(1).Find("a").First().Text()

		// Upload date, size, seeders, and leechers, are the text of
		// other <span> tags.
		t.UplDate = s.Find("span").Eq(2).Text()
		t.Size = s.Find("span").Eq(4).Text()

		// We convert seeders and leechers to integers and
		// conversion fails we convert it to -1.
		seedersStr := s.Find("span").Eq(5).Text()
		seedersStr = strings.TrimSpace(seedersStr)
		seeders, err := strconv.Atoi(seedersStr)

		if err != nil {
			seeders = -1
		}
		t.Seeders = seeders

		leechersStr := s.Find("span").Eq(6).Text()
		leechersStr = strings.TrimSpace(leechersStr)
		leechers, err := strconv.Atoi(leechersStr)
		if err != nil {
			leechers = -1
		}
		t.Leechers = leechers

		torrents = append(torrents, t)
	})

	return torrents
}
