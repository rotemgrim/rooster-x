package engine

import (
	"cmp"
	"log"
	"slices"
)

// transfer is what a torrent is allowed to do. It is derived from the
// session entry; reconcileLocked is the only place that tells anacrolix.
type transfer struct{ down, up bool }

func (e *sessionEntry) wantedTransfer() transfer {
	return transfer{down: !e.Paused && !e.live.queued, up: !e.Paused}
}

// reconcileLocked makes the torrent's allowed transfers match its entry.
// Call with mu held.
func reconcileLocked(e *sessionEntry) {
	want, t := e.wantedTransfer(), e.live.t
	if want.down != e.live.applied.down {
		if want.down {
			t.AllowDataDownload()
		} else {
			t.DisallowDataDownload()
		}
	}
	if want.up != e.live.applied.up {
		if want.up {
			t.AllowDataUpload()
		} else {
			t.DisallowDataUpload()
		}
	}
	e.live.applied = want
}

// reconcileAllLocked works out which torrents are queued (the oldest
// MaxActiveDownloads unfinished, unpaused ones may download) and reconciles
// every torrent. Call with mu held after anything that changes those inputs.
func reconcileAllLocked() {
	var waiting []*sessionEntry
	for _, e := range sessions {
		e.live.queued = false
		if !e.Paused && !isComplete(e.live.t) {
			waiting = append(waiting, e)
		}
	}
	if limit := settings.MaxActiveDownloads; limit > 0 && len(waiting) > limit {
		slices.SortFunc(waiting, func(a, b *sessionEntry) int {
			return cmp.Or(cmp.Compare(a.AddedAt, b.AddedAt), cmp.Compare(a.live.hash, b.live.hash))
		})
		for _, e := range waiting[limit:] {
			e.live.queued = true
		}
	}
	for _, e := range sessions {
		reconcileLocked(e)
	}
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
