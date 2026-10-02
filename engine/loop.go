package engine

import (
	"log"
	"time"
)

const (
	loopEvery = time.Second
	// every this many ticks: save resume data and re-apply part names
	saveEvery = 30
)

// loop handles libtorrent's events, applies the seeding limits and keeps the
// resume data and session file up to date.
func loop() {
	defer close(loopDone)
	tick := time.NewTicker(loopEvery)
	defer tick.Stop()
	for n := 1; ; n++ {
		select {
		case <-stopLoop:
			return
		case <-tick.C:
		}
		handleEvents()
		for _, hash := range seedingFinished(time.Now()) {
			endSeeding(hash)
		}
		if n%saveEvery == 0 {
			healPartNames()
			if err := ses.SaveResume(resumePath(""), true, 10000); err != nil {
				log.Println("Could not save torrent resume data:", err)
			}
		}
		flushSession()
	}
}

func handleEvents() {
	events, err := ses.Events()
	if err != nil {
		return
	}
	for _, ev := range events {
		switch ev.Type {
		case "metadata":
			onMetadata(ev.Hash)
		case "checked", "file_completed":
			if !isMigrating(ev.Hash) {
				fixPartNames(ev.Hash, false)
			}
		case "file_renamed":
			onRenamed(ev.Hash)
		case "file_rename_failed":
			// retried by healPartNames
			log.Println("Could not rename torrent file:", ev.Hash, ev.File, ev.Message)
			onRenamed(ev.Hash)
		case "error":
			log.Println("Torrent error:", ev.Hash, ev.Message)
		}
	}
}

// seedingFinished returns the seeding torrents that reached a seeding limit.
func seedingFinished(now time.Time) []string {
	statuses, err := ses.Statuses()
	if err != nil {
		return nil
	}
	mu.Lock()
	defer mu.Unlock()
	var done []string
	for _, st := range statuses {
		e, ok := sessions[st.Hash]
		if !ok || !st.Finished || userPaused(st.Paused, st.AutoManaged) {
			continue
		}
		if seedingDone(settings, seedStats{
			CompletedAt:    st.CompletedTime,
			ResumedAt:      e.ResumedAt,
			Downloaded:     st.AllTimeDownload,
			Uploaded:       st.AllTimeUpload,
			ResumeUploaded: e.ResumeUploaded,
			Completed:      st.TotalDone,
		}, now) {
			done = append(done, st.Hash)
		}
	}
	return done
}

// endSeeding applies the seed end action to a torrent that reached a
// seeding limit.
func endSeeding(hash string) {
	var err error
	if GetSettings().SeedEndAction == SeedEndRemove {
		err = Remove(hash, false)
	} else {
		err = SetPaused(hash, true)
	}
	if err != nil {
		log.Println("Could not stop seeding", hash, err)
	}
}

// userPaused: paused by the user (or a seeding limit), as opposed to waiting
// in the download queue, which keeps the torrent auto-managed.
func userPaused(paused, autoManaged bool) bool {
	return paused && !autoManaged
}
