package main

import (
	"fmt"
	"go-poc/db"
	"go-poc/scheduler"
)

func main() {
	// initialize the database
	db.Init()
	scheduler.Init()

	scheduler.Schedule("12 20 * * *", func() {
		// Your custom logic here
		fmt.Println("Running the scheduled task at 20:00!")
	})

	select {}
}
