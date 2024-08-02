package main

import (
	"fmt"
	"go-poc/db"
	"go-poc/scheduler"
	"go-poc/server"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	// initialize the database
	db.Init()
	scheduler.Init()

	// start the web server
	go server.StartWebServer()
	fmt.Println("Server started")

	//go walker.FullSweep()
	// scheduler.Schedule("10 21 * * *", walker.FullSweep)

	// create a channel to listen for signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// block until a signal is received
	select {
	case _ = <-sigChan:
		// handle the signal and exit
		println("Exiting")
		os.Exit(0)
	}
}
