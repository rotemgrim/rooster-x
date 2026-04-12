package iptv

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

type XtreamClient struct {
	Username string
	Password string
	Server   string
}

func NewXtreamClient(username, password, server string) *XtreamClient {
	return &XtreamClient{
		Username: username,
		Password: password,
		Server:   strings.TrimRight(server, "/"),
	}
}

func (x *XtreamClient) RefreshLiveStreams() error {
	if x.Username == "" || x.Password == "" || x.Server == "" {
		return fmt.Errorf("xtream config is incomplete: username, password, and server are required")
	}

	url := fmt.Sprintf("%s/player_api.php?username=%s&password=%s&action=get_live_streams",
		x.Server, x.Username, x.Password)

	log.Println("Fetching live streams from xtream:", x.Server)

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to fetch live streams: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("xtream API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	err = os.WriteFile("live_streams.json", body, 0644)
	if err != nil {
		return fmt.Errorf("failed to write live_streams.json: %w", err)
	}

	log.Printf("Saved live_streams.json (%d bytes)", len(body))
	return nil
}
