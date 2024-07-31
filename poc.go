package main

import (
	"go-poc/db"
	"go-poc/scheduler"
	"go-poc/walker"
)

func main() {
	// initialize the database
	db.Init()
	scheduler.Init()

	go walker.FullSweep()
	// scheduler.Schedule("10 21 * * *", walker.FullSweep)

	select {}
}
