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

func TestSeason(t *testing.T) {
	tests := []struct {
		path   string
		season int
	}{
		{"Show/Show.S01E02.1080p.mkv", 1},
		{"Show/show_s04e01.mkv", 4},
		{"Show/Show 2x05 720p.mkv", 2},
		{"Show/Show.S01E100.mkv", 1},
		{"Show/Season 3/ep 01.mkv", 3},
		{"Show/The Show Season 12/01.mkv", 12},
		{"Show/S02/03.mkv", 2},
		{`Show\Season 3\ep 01.mkv`, 3},
		{"Show/Season 3/Show.S04E01.mkv", 4},
		{"Show/Movie.1920x1080.x264.mkv", 0},
		{"Show/extras/making of.mkv", 0},
		{"Show.S03.1080p/03.mkv", 0},
		{"", 0},
	}
	for _, tt := range tests {
		if got := Season(tt.path); got != tt.season {
			t.Errorf("Season(%q) = %d, want %d", tt.path, got, tt.season)
		}
	}
}
