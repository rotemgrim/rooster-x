package ptnutil

import "testing"

func TestSafeParseEpisodes(t *testing.T) {
	tests := []struct {
		name            string
		season, episode int
		title           string
	}{
		{"Show.S01E05.1080p.WEB-DL.mkv", 1, 5, "Show"},
		{"Show.S01E99.1080p.WEB-DL.mkv", 1, 99, "Show"},
		{"Show.S01E100.1080p.WEB-DL.mkv", 1, 100, "Show"},
		{"Show S02E1234 720p.mkv", 2, 1234, "Show"},
		{"Show_S01E150_HDTV.avi", 1, 150, "Show"},
		{"Show.S01E100E101.mkv", 1, 100, "Show"},
		{"Show 1x101.mkv", 1, 101, "Show"},
		{"Movie.2019.1080p.x264.mkv", 0, 0, "Movie"},
		{"Clip.1080x1920.mp4", 0, 0, ""},
	}
	for _, tt := range tests {
		info, err := SafeParse(tt.name)
		if err != nil {
			t.Fatalf("%s: %v", tt.name, err)
		}
		// Without an episode the season is upstream's guess (1080x1920 gives 80).
		if info.Episode != tt.episode || (tt.episode > 0 && info.Season != tt.season) {
			t.Errorf("%s: got S%dE%d, want S%dE%d", tt.name, info.Season, info.Episode, tt.season, tt.episode)
		}
		if tt.title != "" && info.Title != tt.title {
			t.Errorf("%s: got title %q, want %q", tt.name, info.Title, tt.title)
		}
	}
}
