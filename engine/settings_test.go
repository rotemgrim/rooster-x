package engine

import (
	"testing"
	"time"
)

func TestSeedingDone(t *testing.T) {
	now := time.Now()
	hoursAgo := func(h int) int64 { return now.Add(-time.Duration(h) * time.Hour).Unix() }

	tests := []struct {
		name string
		s    Settings
		st   seedStats
		want bool
	}{
		{"not finished", Settings{SeedDays: 1}, seedStats{}, false},
		{"days reached", Settings{SeedDays: 2}, seedStats{CompletedAt: hoursAgo(49)}, true},
		{"days not reached", Settings{SeedDays: 2}, seedStats{CompletedAt: hoursAgo(47)}, false},
		{"fractional days", Settings{SeedDays: 0.5}, seedStats{CompletedAt: hoursAgo(13)}, true},
		{"resume restarts days", Settings{SeedDays: 2}, seedStats{CompletedAt: hoursAgo(49), ResumedAt: hoursAgo(1)}, false},
		{"no limits", Settings{}, seedStats{CompletedAt: hoursAgo(1000), Downloaded: 1, Uploaded: 100, Completed: 1}, false},
		{"ratio reached", Settings{RatioLimit: 1}, seedStats{CompletedAt: 1, Downloaded: 1000, Uploaded: 1000, Completed: 1000}, true},
		{"ratio not reached", Settings{RatioLimit: 1}, seedStats{CompletedAt: 1, Downloaded: 1000, Uploaded: 999, Completed: 1000}, false},
		{"resume restarts ratio", Settings{RatioLimit: 1}, seedStats{CompletedAt: 1, Downloaded: 1000, Uploaded: 1500, ResumeUploaded: 1000, Completed: 1000}, false},
		{"data from disk uses size", Settings{RatioLimit: 1}, seedStats{CompletedAt: 1, Uploaded: 2000, Completed: 2000}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := seedingDone(tt.s, tt.st, now); got != tt.want {
				t.Errorf("seedingDone = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestShareRatio(t *testing.T) {
	tests := []struct {
		uploaded, downloaded, completed int64
		want                            float64
	}{
		{500, 1000, 1000, 0.5},
		{500, 0, 1000, 0.5}, // from disk: divide by size
		{500, 5, 1000, 0.5}, // under 1% downloaded: still from disk
		{500, 20, 1000, 25}, // 2% downloaded counts
		{0, 0, 0, 0},        // nothing yet
	}
	for _, tt := range tests {
		if got := shareRatio(tt.uploaded, tt.downloaded, tt.completed); got != tt.want {
			t.Errorf("shareRatio(%d, %d, %d) = %v, want %v", tt.uploaded, tt.downloaded, tt.completed, got, tt.want)
		}
	}
}
