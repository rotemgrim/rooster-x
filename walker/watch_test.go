package walker

import "testing"

func TestIgnoredWatchPath(t *testing.T) {
	tests := map[string]bool{
		`B:\downloads\.roosterx-resume`:                     true,
		`B:\downloads\.roosterx-torrents.json`:              true,
		`B:\downloads\Movie.2024.1080p.mkv.part`:            true,
		`B:\downloads\Movie.2024.1080p.MKV.PART`:            true,
		`B:\downloads\Movie.2024.1080p.mkv`:                 false,
		`B:\downloads\Show.S01E01`:                          false, // a release folder
		`B:\downloads\Show.S01E01\episode.mkv`:              false,
		`B:\downloads\partial.mkv`:                          false,
		`B:\downloads\Some.Movie.Part.2.2024.mkv`:           false,
		`B:\downloads\Some.Movie.Part.2.2024.mkv.part`:      true,
		`/home/user/downloads/.hidden/file.mkv`:             false, // only the event's own name counts
		`/home/user/downloads/.hidden`:                      true,
		`/home/user/downloads/Movie.2024.1080p.mkv.partial`: false,
	}
	for path, want := range tests {
		if got := ignoredWatchPath(path); got != want {
			t.Errorf("ignoredWatchPath(%q) = %v, want %v", path, got, want)
		}
	}
}
