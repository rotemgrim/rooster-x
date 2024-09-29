package imdb

import (
	"testing"
)

func TestSignToIMDB(t *testing.T) {
	type args struct {
		username string
		password string
	}

	t.Run("check sign-in", func(t *testing.T) {
		GetRecommendedList("rotemgrim@gmail.com", "REMOVED_PASSWORD")
	})
}
