package main

import (
	"fmt"
	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/getlantern/systray"
	"github.com/getlantern/systray/example/icon"
	"go-poc/db"
	EventBus "go-poc/event-bus"
	"go-poc/scheduler"
	"go-poc/server"
	"go-poc/torrents"
	"go-poc/walker"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
)

type App struct {
	Scheduler       *scheduler.Scheduler
	Server          *server.Server
	Walker          *walker.Walker
	TorrentsFetcher *torrents.TorrentFetcher
}

var app *App

func main() {
	systray.Run(onReady, onExit)
}

func onExit() {
	app.Walker.StopWatch()
	// handle the signal and exit
	os.Remove("sweep.lock")
	println("Exiting")
	os.Exit(0)
}

func listenForIncomingMessages() {
	go func() {
		for {
			req := EventBus.ReceiveData()
			fmt.Println("Received data:", req.Event)
			if req.Event == "sweep-done" {
				systray.SetIcon(RoosterIcon)
			} else if req.Event == "get-imdb-ratings" {
				// mock the response
				//req.Response <- server.GetImdbRatings(req.Data.(string))
			}
		}
	}()
}

func onReady() {

	// initialize system tray
	trayInitialize()

	// initialize the database
	db.Init()

	// initialize the config file
	initializeConfig()

	schedulerInstance := scheduler.NewScheduler()
	ServerInstance := server.NewServer("static")
	tmdbClient, err := tmdb.Init("REMOVED_TMDB_API_KEY")
	if err != nil {
		fmt.Println("Error initializing tmdb client")
		return
	}

	// directories array to walk
	dirs := []string{
		//"B:\\downloads\\complete",
		"C:\\Users\\rotem\\Downloads",
		//"B:\\dekel",
	}
	WalkerInstance := walker.NewWalker(dirs, ServerInstance, tmdbClient)
	TorrentsFetcher := torrents.NewTorrentFetcher("https://thepiratebay.org", ServerInstance, tmdbClient)

	// create a new app
	app = &App{
		Scheduler:       schedulerInstance,
		Server:          ServerInstance,
		Walker:          WalkerInstance,
		TorrentsFetcher: TorrentsFetcher,
	}

	app.Walker.StartWatch()
	go app.Server.Start(WalkerInstance, TorrentsFetcher)
	app.Scheduler.Init()
	app.Scheduler.Schedule("41 0 * * *", app.Walker.FullSweep)             // every day at 09:00
	app.Scheduler.Schedule("0 19 * * *", app.Walker.FullSweep)             // every day at 19:00
	app.Scheduler.Schedule("0 10 * * *", app.TorrentsFetcher.GetTorrents)  // every day at 10:00
	app.Scheduler.Schedule("30 19 * * *", app.TorrentsFetcher.GetTorrents) // every day at 19:30

	// schedule the imdb ratings fetcher
	//app.Scheduler.Schedule("* * * * *", server.ImdbRatingPoll)

	// create a channel to listen for signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// start listening for incoming messages
	listenForIncomingMessages()

	// block until a signal is received
	select {
	case _ = <-sigChan:
		onExit()
	}
}

func initializeConfig() {
	// check if config file exists
	if _, err := os.Stat("config.yaml"); os.IsNotExist(err) {
		// create a new config file
		file, err := os.Create("config.yaml")
		if err != nil {
			fmt.Println("Error creating config file")
			return
		}
		defer file.Close()

		defaultConfig := []byte(
			`
app_name: "MyApp"
port: 8080
db:
	user: "admin"
	password: "secret"
	host: "localhost"
	name: "mydb"
`)

		// write the default config to the file
		_, err = file.WriteString(string(defaultConfig))
		if err != nil {
			fmt.Println("Error writing to config file")
			panic(fmt.Errorf("Error writing to config file", err))
		}
	}

}

func trayInitialize() {

	// create a new system tray
	systray.SetIcon(RoosterIcon)
	systray.SetTitle("RoosterX")
	systray.SetTooltip("RoosterX")
	mOpen := systray.AddMenuItem("Open", "Show the app")
	systray.AddSeparator()
	mSweep := systray.AddMenuItem("Sweep Files", "Run a full sweep on the file system")
	mTorrentFetch := systray.AddMenuItem("Fetch Torrents", "Fetch torrents from pirate bay")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("❌ Quit", "Quit the whole app")

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowserInKiosk(0)
			case <-mSweep.ClickedCh:
				systray.SetIcon(icon.Data)
				app.Walker.FullSweep()
			case <-mTorrentFetch.ClickedCh:
				systray.SetIcon(icon.Data)
				app.TorrentsFetcher.GetTorrents()
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func openBrowserInKiosk(index int) {
	// Path to the Chrome executable
	chromePathArr := []string{
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	}

	if index >= len(chromePathArr) {
		fmt.Println("Chrome not found")
		return
	}

	// URL to open in kiosk mode
	url := "http://localhost:5173"
	// Command to run Chrome in kiosk mode
	cmd := exec.Command(chromePathArr[index],
		"--new-window",
		"--kiosk",
		"--user-data-dir=C:\\Temp\\ChromeKiosk",
		"--remote-debugging-port=9222",
		url)
	// Start the command
	err := cmd.Start()
	if err != nil {
		openBrowserInKiosk(index + 1)
	}
}
