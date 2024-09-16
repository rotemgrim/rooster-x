package main

import (
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	"go-poc/db"
	"go-poc/scheduler"
	"go-poc/server"
	"go-poc/torrents"
	"go-poc/walker"
	"os"
	"os/signal"
	"syscall"
)

type App struct {
	Scheduler       *scheduler.Scheduler
	Server          *server.Server
	Walker          *walker.Walker
	TorrentsFetcher *torrents.TorrentFetcher
}

func main() {

	// initialize the database
	db.Init()

	schedulerInstance := scheduler.NewScheduler()
	ServerInstance := server.NewServer("static")
	tmdbClient, err := tmdb.Init("REMOVED_TMDB_API_KEY")
	if err != nil {
		fmt.Println("Error initializing tmdb client")
		return
	}

	// directories array to walk
	dirs := []string{
		"B:\\downloads\\complete",
		//"C:\\Users\\rotem\\Downloads",
		"B:\\dekel",
	}
	WalkerInstance := walker.NewWalker(dirs, ServerInstance, tmdbClient)
	TorrentsFetcher := torrents.NewTorrentFetcher("https://thepiratebay.org", ServerInstance, tmdbClient)

	// create a new app
	app := &App{
		Scheduler:       schedulerInstance,
		Server:          ServerInstance,
		Walker:          WalkerInstance,
		TorrentsFetcher: TorrentsFetcher,
	}

	//// Path to the Chrome executable
	//chromePath := "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
	//// URL to open in kiosk mode
	//url := "https://google.com"
	//// Command to run Chrome in kiosk mode
	//cmd := exec.Command(chromePath, "--kiosk", url)
	//// Start the command
	//err = cmd.Start()
	//if err != nil {
	//	fmt.Println("Error starting Chrome:", err)
	//	return
	//}

	app.Walker.StartWatch()
	go app.Server.Start(WalkerInstance, TorrentsFetcher)
	//go TorrentsFetcher.Fetch()
	//go app.Walker.FullSweep()
	//app.Scheduler.Schedule("10 21 * * *", app.Walker.FullSweep)

	// create a channel to listen for signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// block until a signal is received
	select {
	case _ = <-sigChan:
		app.Walker.StopWatch()
		// handle the signal and exit
		os.Remove("sweep.lock")
		println("Exiting")
		os.Exit(0)
	}
}
