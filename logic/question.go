package logic

import "time"

type Question struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Brewery   string    `json:"brewery"`
	Abv       float32   `json:"abv"`
	ShortDesc string    `json:"short_description"`
	Created   time.Time `json:"created"`
}



type Service struct {
}

type Repository interface {
	// AddBeer saves a given beer to the repository.
	AddBeer(question Question) error
}

type service struct {
	bR Repository
}

// NewService creates an adding service with the necessary dependencies
func NewService(r Repository) Service {
	return &service{r}
}


func (s *service) AddBeer(b ...Question) {

	// any validation can be done here

	for _, beer := range b {
		_ = s.bR.AddBeer(beer) // error handling omitted for simplicity
	}
}