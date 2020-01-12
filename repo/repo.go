package repo

import (
	"database/sql"
	"github.com/nlimpid/quki/logic"
)

type Storage struct {
	db *sql.DB
}

func New(db *sql.DB) *Storage {
	return &Storage{db:db}
}

func (m *Storage) AddBeer(question logic.Question) error {

	return nil
}