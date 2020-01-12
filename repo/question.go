package repo

import "time"

// Question defines a beer review
type Question struct {
	ID        string
	BeerID    int
	FirstName string
	LastName  string
	Score     int
	Text      string
	Created   time.Time
}
