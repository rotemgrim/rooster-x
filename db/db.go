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

// SQLite DSN pragmas:
//   - journal_mode=WAL    : readers don't block writers and vice versa
//   - busy_timeout=10000  : retry for up to 10s on lock contention instead of failing immediately
//   - synchronous=NORMAL  : safe + faster than FULL under WAL
//   - foreign_keys=ON
//   - cache_size=-65536   : ~64 MiB page cache (negative = KiB)
//   - mmap_size=268435456 : 256 MiB memory-mapped I/O so hot pages stay
//     resident in the process address space and
//     subsequent queries are ~zero-IO.
//   - temp_store=MEMORY   : keep ORDER BY / GROUP BY scratch in RAM
const dsn = "file:" + filename + "?_pragma=journal_mode(WAL)" +
	"&_pragma=busy_timeout(10000)" +
	"&_pragma=synchronous(NORMAL)" +
	"&_pragma=foreign_keys(1)" +
	"&_pragma=cache_size(-65536)" +
	"&_pragma=mmap_size(268435456)" +
	"&_pragma=temp_store(MEMORY)"

//var MediaRepo MediaRepo

var DB *sql.DB
var CTX context.Context

func Init() {
	var err error
	DB, err = sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatal(err)
	}
	// With WAL, many readers + one writer can work concurrently.
	// busy_timeout (set via DSN) handles transient write contention.
	DB.SetMaxOpenConns(10)
	DB.SetMaxIdleConns(5)

	// Set boil DB before creating tables (needed for migration)
	boil.SetDB(DB)

	createTablesIfNotExist(DB)

	// Create a context with a timeout
	CTX, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	users, err := models.Users().All(CTX, DB)
	if err != nil {
		log.Printf("Warning: could not fetch users: %v", err)
	}
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
	//	log.Println(stmt.ColumnInt(0), stmt.ColumnText(1))
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
