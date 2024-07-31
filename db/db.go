package db

import (
	"database/sql"
	_ "github.com/ncruces/go-sqlite3/embed"
	"log"
	"reflect"
)

const filename = "db.sqlite" // ":memory:"

//var MediaRepo MediaRepo

var DB *sql.DB

func Init() {
	DB, err := sql.Open("sqlite3", filename)
	if err != nil {
		log.Fatal(err)
	}

	createTablesIfNotExist(DB)

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
