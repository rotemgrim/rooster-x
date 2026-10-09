package main

import (
	"go-poc/config"
	"go-poc/db"
	"go-poc/engine"
	EventBus "go-poc/event-bus"
	"go-poc/iptv"
	"go-poc/scheduler"
	"go-poc/server"
	gtmdb "go-poc/tmdb"
	"go-poc/torrents"
	"go-poc/walker"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"syscall"
	"time"

	tmdb "github.com/cyruzin/golang-tmdb"
	"github.com/getlantern/systray"
	"github.com/getlantern/systray/example/icon"
	"github.com/skratchdot/open-golang/open"
	"gopkg.in/natefinch/lumberjack.v2"
)

type App struct {
	Scheduler       *scheduler.Scheduler
	Server          *server.Server
	Walker          *walker.Walker
	TorrentsFetcher *torrents.TorrentFetcher
	XtreamClient    *iptv.XtreamClient
}

var app *App

// safeGo runs fn in a new goroutine with a top-level recover so a panic
// inside long-running background work (sweeps, torrent fetch, enrichment,
// IPTV refresh) is logged with a stack trace instead of taking the whole
// process down. Bare `go fn()` calls used to crash the app on the first
// panic deep in the pipeline (e.g. mid-sweep) — see the "app closes after
// full sweep" issue.
func safeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC in %s: %v\n%s", name, r, debug.Stack())
			}
		}()
		fn()
	}()
}

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
	engine.Stop()
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
			// EventBus.SendEvent blocks on req.Response until someone
			// writes to it. Always unblock the sender so fire-and-forget
			// events don't deadlock the caller (e.g. the torrent sweep
			// was hanging here and never reaching db.RebuildFeeds()).
			select {
			case req.Response <- nil:
			default:
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

	// Ensure the materialised feed_torrents / feed_folders tables are
	// populated. On a fresh install they're empty -> rebuild synchronously
	// (off-thread so boot isn't blocked). On subsequent boots the tables
	// already hold the last sweep's snapshot, so the user gets fast first
	// click and the next sweep refreshes them.
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC in feed warmup: %v\n%s", r, debug.Stack())
			}
		}()
		if db.FeedTablesEmpty() {
			db.RebuildFeeds()
		}
	}()

	cfg, needsSetup, err := config.Load()
	if err != nil {
		panic(err)
	}

	// the server comes up before the rest of the app so it can show the
	// setup wizard on first run
	var setupDone <-chan config.Config
	if needsSetup {
		setupDone = server.RequireSetup(cfg)
	}
	ServerInstance := server.NewServer("static")
	go ServerInstance.Start()
	if needsSetup {
		log.Println("No configuration yet, waiting for the setup wizard")
		openBrowserInKiosk(0)
		cfg = <-setupDone
		log.Println("Setup complete")
	}

	schedulerInstance := scheduler.NewScheduler()
	tmdbClient, err := tmdb.Init(cfg.TmdbApiKey)
	gtmdb.SetLang(cfg.Lang)
	gtmdb.SetEnrichmentClient(tmdbClient)
	gtmdb.SetEnrichmentBroadcaster(func(msg string) {
		ServerInstance.BroadcastMessage(msg)
	})
	gtmdb.SetEnrichmentLifecycle(
		func() { systray.SetIcon(icon.Data) },
		func() { systray.SetIcon(RoosterIcon) },
	)
	server.EnrichMetadataFn = gtmdb.EnrichOne
	server.RefreshEpisodesFn = gtmdb.RefreshEpisodes
	server.SetTmdbApiKey(cfg.TmdbApiKey)
	server.SetXtreamConfig(cfg.Xtream.Username, cfg.Xtream.Password, cfg.Xtream.Server)

	if err != nil {
		log.Println("Error initializing tmdb client: set tmdb_api_key in config.yaml:", err)
		return
	}
	// the client sets its default timeout on every request when none is set,
	// a data race once requests run at the same time (episode refreshes,
	// websocket requests, sweeps), so set it once here
	tmdbClient.SetClientConfig(http.Client{Timeout: 10 * time.Second})

	// directories array to walk
	dirs := cfg.Directories
	WalkerInstance := walker.NewWalker(dirs, ServerInstance, tmdbClient)
	TorrentsFetcher := torrents.NewTorrentFetcher(ServerInstance, tmdbClient)

	// create a new app
	xtreamClient := iptv.NewXtreamClient(cfg.Xtream.Username, cfg.Xtream.Password, cfg.Xtream.Server)

	app = &App{
		Scheduler:       schedulerInstance,
		Server:          ServerInstance,
		Walker:          WalkerInstance,
		TorrentsFetcher: TorrentsFetcher,
		XtreamClient:    xtreamClient,
	}

	// embedded torrent engine; downloads land in a watched directory by
	// default so the walker picks them up like any other media file
	downloadDir := cfg.DownloadDir
	if downloadDir == "" && len(dirs) > 0 {
		downloadDir = dirs[0]
	}
	if downloadDir == "" {
		downloadDir = "downloads"
	}
	if err := engine.Start(downloadDir); err != nil {
		log.Println("Torrent engine disabled:", err)
	}

	app.Walker.StartWatch()
	app.Server.SetSweepers(WalkerInstance, TorrentsFetcher)
	app.Scheduler.Init()

	for _, schedule := range cfg.FullDirectoriesSweep {
		app.Scheduler.Schedule(schedule, func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC in scheduled FullSweep: %v\n%s", r, debug.Stack())
				}
			}()
			app.Walker.FullSweep()
		})
	}

	for _, schedule := range cfg.TorrentsSweep {
		app.Scheduler.Schedule(schedule, func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("PANIC in scheduled GetTorrents: %v\n%s", r, debug.Stack())
				}
			}()
			app.TorrentsFetcher.GetTorrents()
		})
	}

	// schedule the imdb ratings fetcher
	if cfg.ImdbRatingPoll != "" {
		app.Scheduler.Schedule(cfg.ImdbRatingPoll, server.ImdbRatingPoll)
	}

	// refresh the IMDb ratings dataset daily; IMDb publishes it around 01:00 UTC
	app.Scheduler.Schedule("0 4 * * *", server.RefreshImdbRatings)

	// schedule periodic metadata enrichment from TMDB.
	// By default this is a nightly window (2-4 AM); see config.yaml.
	if cfg.MetadataEnrichPoll != "" {
		app.Scheduler.Schedule(cfg.MetadataEnrichPoll, func() {
			gtmdb.RunEnrichmentSweep(500)
		})
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
	mEnrich := systray.AddMenuItem("Enrich Metadata", "Refresh metadata for items needing enrichment")
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
				if app == nil { // still in first-run setup
					continue
				}
				systray.SetIcon(icon.Data)
				safeGo("FullSweep", app.Walker.FullSweep)
			case <-mTorrentFetch.ClickedCh:
				if app == nil {
					continue
				}
				systray.SetIcon(icon.Data)
				safeGo("GetTorrents", app.TorrentsFetcher.GetTorrents)
			case <-mRefreshIPTV.ClickedCh:
				if app == nil {
					continue
				}
				systray.SetIcon(icon.Data)
				safeGo("RefreshLiveStreams", func() {
					err := app.XtreamClient.RefreshLiveStreams()
					if err != nil {
						log.Println("Error refreshing IPTV:", err)
					}
					systray.SetIcon(RoosterIcon)
				})
			case <-mEnrich.ClickedCh:
				// Tray icon swap is handled by the lifecycle hooks set in onReady.
				safeGo("EnrichmentSweep", func() { gtmdb.RunEnrichmentSweep(500) })
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
