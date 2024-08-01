package db

import (
	"context"
	"database/sql"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"go-poc/models"
	"log"
	_ "modernc.org/sqlite"
	"reflect"
	"time"
)

const filename = "db.sqlite" // ":memory:"

//var MediaRepo MediaRepo

var DB *sql.DB
var CTX context.Context

func Init() {
	DB, err := sql.Open("sqlite", filename)
	if err != nil {
		log.Fatal(err)
	}
	createTablesIfNotExist(DB)

	// Create a context with a timeout
	CTX, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	boil.SetDB(DB)

	users := models.Users().AllGP(CTX)
	for _, t := range users {
		log.Println(t)
	}

	// initiate Media repository
	//MediaRepo = new MediaRepo{db: db}

	//err = db.Exec(`INSERT INTO users (id, name) VALUES (0, 'go'), (1, 'zig'), (2, 'whatever')`)
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//stmt, _, err := db.Prepare(`SELECT id, name FROM users`)
	//if err != nil {
	//	log.Fatal(err)
	//}
	//defer stmt.Close()
	//
	//for stmt.Step() {
	//	fmt.Println(stmt.ColumnInt(0), stmt.ColumnText(1))
	//}
	//if err := stmt.Err(); err != nil {
	//	log.Fatal(err)
	//}
	//
	//err = stmt.Close()
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//err = db.Close()
	//if err != nil {
	//	log.Fatal(err)
	//}
}

func scanStruct(rows *sql.Rows, dest interface{}) error {
	v := reflect.ValueOf(dest).Elem()
	values := make([]interface{}, v.NumField())

	for i := 0; i < v.NumField(); i++ {
		values[i] = v.Field(i).Addr().Interface()
	}

	return rows.Scan(values...)
}
