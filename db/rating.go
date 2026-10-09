package db

import (
	"database/sql/driver"
	"regexp"
	"strconv"
	"strings"

	"modernc.org/sqlite"
)

// named ratings that carry no age in their text
var ratingAges = map[string]int64{
	// US film
	"G": 0, "PG": 7, "PG-13": 13, "R": 17, "NC-17": 18,
	// US TV
	"TV-Y": 0, "TV-G": 0, "TV-Y7": 7, "TV-Y7-FV": 7, "TV-PG": 10, "TV-14": 14, "TV-MA": 17,
	// "for everyone" in other countries
	"U": 0, "L": 0, "E": 0, "T": 0, "AL": 0, "ALL": 0, "APTA": 0, "TP": 0,
	// adult-only in other countries
	"A": 18, "X": 18, "M": 15,
}

var firstNumber = regexp.MustCompile(`\d+`)

// RatingToAge turns a stored certification (PG-13, TV-MA, 12A, FSK 16,
// MA15+...) into the youngest age it is meant for. Unrated or unknown
// ratings return false.
func RatingToAge(rating string) (int64, bool) {
	r := strings.ToUpper(strings.TrimSpace(rating))
	if age, ok := ratingAges[r]; ok {
		return age, true
	}
	if n := firstNumber.FindString(r); n != "" {
		age, err := strconv.ParseInt(n, 10, 64)
		return age, err == nil && age <= 21
	}
	return 0, false
}

// rating_age(ageRating) is available in every query, so the age limit can be
// applied in SQL. It returns NULL for unrated media, and NULL <= limit is
// false, so a limited user never sees unrated media.
func init() {
	err := sqlite.RegisterDeterministicScalarFunction("rating_age", 1,
		func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			s, ok := args[0].(string)
			if !ok {
				return nil, nil
			}
			if age, ok := RatingToAge(s); ok {
				return age, nil
			}
			return nil, nil
		})
	if err != nil {
		panic(err)
	}
}
