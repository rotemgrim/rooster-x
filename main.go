package main

import (
	"fmt"
	"go-poc/db"
	EventBus "go-poc/event-bus"
	"go-poc/iptv"
	"go-poc/scheduler"
	"go-poc/server"
	gtmdb "go-poc/tmdb"
	"go-poc/torrents"
	"go-poc/walker"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/getlantern/systray"
	"github.com/getlantern/systray/example/icon"
	"github.com/skratchdot/open-golang/open"
	"gopkg.in/natefinch/lumberjack.v2"
	"gopkg.in/yaml.v3"
)

type XtreamConfig struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	Server   string `yaml:"server"`
}

type Config struct {
	TmdbApiKey           string       `yaml:"tmdb_api_key"`
	Lang                 string       `yaml:"lang"`
	Directories          []string     `yaml:"directories"`
	FullDirectoriesSweep []string     `yaml:"full_directories_sweep"`
	TorrentsSweep        []string     `yaml:"torrents_sweep"`
	ImdbRatingPoll       string       `yaml:"imdb_rating_poll"`
	Xtream               XtreamConfig `yaml:"xtream"`
}

type App struct {
	Scheduler       *scheduler.Scheduler
	Server          *server.Server
	Walker          *walker.Walker
	TorrentsFetcher *torrents.TorrentFetcher
	XtreamClient    *iptv.XtreamClient
}

var app *App

func main() {
	logger := &lumberjack.Logger{
		Filename:   "tmp/rooster.log",
		MaxSize:    5, // megabytes
		MaxBackups: 3,
		MaxAge:     28, // days
		// Compress:   true, // disabled by default
	}
	log.SetOutput(logger)
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
			log.Println("Received data:", req.Event)
			if req.Event == "sweep-done" {
				systray.SetIcon(RoosterIcon)
			} else if req.Event == "get-imdb-ratings" {
				// mock the response
				// req.Response <- server.GetImdbRatings(req.Data.(string))
			}
		}
	}()
}

func onReady() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC RECOVERED in onReady: %v", r)
			log.Printf("Stack trace: %+v", r)
			panic(r) // Re-panic to see full stack trace
		}
	}()

	log.Println("RoosterX has started ======================")

	// initialize system tray
	trayInitialize()

	// initialize the database
	db.Init()

	// initialize the config file
	config := initializeConfig()

	schedulerInstance := scheduler.NewScheduler()
	ServerInstance := server.NewServer("static")
	tmdbClient, err := tmdb.Init(config.TmdbApiKey)
	gtmdb.SetLang(config.Lang)
	server.SetTmdbApiKey(config.TmdbApiKey)
	server.SetXtreamConfig(config.Xtream.Username, config.Xtream.Password, config.Xtream.Server)

	if err != nil {
		log.Println("Error initializing tmdb client")
		return
	}

	// directories array to walk
	dirs := config.Directories
	WalkerInstance := walker.NewWalker(dirs, ServerInstance, tmdbClient)
	TorrentsFetcher := torrents.NewTorrentFetcher("https://thepiratebay.org", ServerInstance, tmdbClient)

	// create a new app
	xtreamClient := iptv.NewXtreamClient(config.Xtream.Username, config.Xtream.Password, config.Xtream.Server)

	app = &App{
		Scheduler:       schedulerInstance,
		Server:          ServerInstance,
		Walker:          WalkerInstance,
		TorrentsFetcher: TorrentsFetcher,
		XtreamClient:    xtreamClient,
	}

	app.Walker.StartWatch()
	go app.Server.Start(WalkerInstance, TorrentsFetcher)
	app.Scheduler.Init()

	for _, schedule := range config.FullDirectoriesSweep {
		app.Scheduler.Schedule(schedule, app.Walker.FullSweep)
	}

	for _, schedule := range config.TorrentsSweep {
		app.Scheduler.Schedule(schedule, app.TorrentsFetcher.GetTorrents)
	}

	// schedule the imdb ratings fetcher
	if config.ImdbRatingPoll != "" {
		app.Scheduler.Schedule(config.ImdbRatingPoll, server.ImdbRatingPoll)
	}

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

func initializeConfig() Config {
	// check if config file exists
	if _, err := os.Stat("config.yaml"); os.IsNotExist(err) {
		// create a new config file
		file, err := os.Create("config.yaml")
		if err != nil {
			log.Println("Error creating config file")
			panic(fmt.Errorf("Error creating config file", err))
		}
		defer file.Close()

		defaultConfig := []byte(
			`
tmdb_api_key: "REMOVED_TMDB_API_KEY"
lang: "en-US"

directories:
    - "B:\\downloads\\complete"
    - "B:\\dekel"

full_directories_sweep:
    - "0 9 * * *" # Every day at 09:00
    - "0 19 * * *" # Every day at 19:00

torrents_sweep:
    - "0 10 * * *" # Every day at 10:00
    - "30 19 * * *" # Every day at 19:30

imdb_rating_poll: "* * * * *" # Every minute

xtream:
    username: ""
    password: ""
    server: ""
`)

		// write the default config to the file
		_, err = file.WriteString(string(defaultConfig))
		if err != nil {
			log.Println("Error writing to config file")
			panic(fmt.Errorf("Error writing to config file", err))
		}
	}

	// read the config file
	configData, err := os.ReadFile("config.yaml")
	if err != nil {
		log.Println("Error reading config file")
		panic(fmt.Errorf("Error reading config file", err))
	}

	// unmarshal the config file
	var cfg Config
	err = yaml.Unmarshal(configData, &cfg)
	if err != nil {
		panic(fmt.Errorf("Error unmarshalling config file", err))
	}

	// spew.Dump(cfg)
	return cfg
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
	mRefreshIPTV := systray.AddMenuItem("Refresh IPTV", "Refresh live streams from Xtream")
	systray.AddSeparator()
	mOpenLogs := systray.AddMenuItem("Open Logs", "Open the log file")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("❌ Quit", "Quit the whole app")

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowserInKiosk(0)
			case <-mSweep.ClickedCh:
				systray.SetIcon(icon.Data)
				go app.Walker.FullSweep()
			case <-mTorrentFetch.ClickedCh:
				systray.SetIcon(icon.Data)
				go app.TorrentsFetcher.GetTorrents()
			case <-mRefreshIPTV.ClickedCh:
				systray.SetIcon(icon.Data)
				go func() {
					err := app.XtreamClient.RefreshLiveStreams()
					if err != nil {
						log.Println("Error refreshing IPTV:", err)
					}
					systray.SetIcon(RoosterIcon)
				}()
			case <-mOpenLogs.ClickedCh:
				logPath, _ := filepath.Abs("tmp/rooster.log")
				open.Run(logPath)
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
		log.Println("Chrome not found")
		return
	}

	// URL to open in kiosk mode
	url := "http://localhost:8080"
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
