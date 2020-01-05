package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"github.com/gorilla/mux"
)

type server struct {
	db     *sql.DB
	router *mux.Router
}


func NewServer() *server {
	s := &server{}
	s.router = mux.NewRouter()

	return s
}

func (s *server) routes() {
	s.router.HandleFunc("/api/", s.handleSomething())
}

func (s *server) respond(w http.ResponseWriter, r *http.Request, data interface{}, status int) {
	w.WriteHeader(status)
	if data != nil {
		err := json.NewEncoder(w).Encode(data)
		// TODO: handle err
		if err != nil {
			return
		}
	}
}

//
//
//func (s *server) adminOnly(h http.HandlerFunc) http.HandlerFunc {
//	return func(w http.ResponseWriter, r *http.Request) {
//		if !currentUser(r).IsAdmin {
//			http.NotFound(w, r)
//			return
//		}
//		h(w, r)
//	}
//}


//ServeHTTP dispatch request
func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

func (s *server) decode(w http.ResponseWriter, r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}



func (s *server) handleSomething() http.HandlerFunc {
	type request struct {
		Name string
	}
	type response struct {
		Greeting string `json:"greeting"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		req := request{}
		_ = s.decode(w, r, &req)
	}
}