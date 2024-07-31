package db

import (
	"github.com/ncruces/go-sqlite3"
	_ "github.com/ncruces/go-sqlite3/embed"
	"log"
)

const filename = "db.sqlite" // ":memory:"

func Init() {
	db, err := sqlite3.Open(filename)
	if err != nil {
		log.Fatal(err)
	}

	createTablesIfNotExist(db)

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
