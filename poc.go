package main

import (
	"go-poc/db"
	"go-poc/scheduler"
	"go-poc/server"
	"go-poc/walker"
	"os"
	"os/signal"
	"syscall"
)

type App struct {
	Scheduler *scheduler.Scheduler
	Server    *server.Server
	Walker    *walker.Walker
}

func main() {

	// initialize the database
	db.Init()

	// create a new app
	app := &App{
		Scheduler: scheduler.NewScheduler(),
		Server:    server.NewServer("static"),
		Walker:    walker.NewWalker("C:\\Users\\rotem\\Downloads"),
		//Walker:    walker.NewWalker("B:\\downloads\\complete"),
	}

	//go app.Server.Start()
	go app.Walker.FullSweep()
	//app.Scheduler.Schedule("10 21 * * *", app.Walker.FullSweep)

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
