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

	schedulerInstance := scheduler.NewScheduler()
	ServerInstance := server.NewServer("static")
	WalkerInstance := walker.NewWalker("B:\\downloads\\complete", ServerInstance)
	//WalkerInstance := walker.NewWalker("C:\\Users\\rotem\\Downloads", ServerInstance)

	// create a new app
	app := &App{
		Scheduler: schedulerInstance,
		Server:    ServerInstance,
		Walker:    WalkerInstance,
	}

	app.Server.Start(WalkerInstance)
	go app.Walker.FullSweep()
	//app.Scheduler.Schedule("10 21 * * *", app.Walker.FullSweep)

	// create a channel to listen for signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// block until a signal is received
	select {
	case _ = <-sigChan:
		// handle the signal and exit
		os.Remove("sweep.lock")
		println("Exiting")
		os.Exit(0)
	}
}
