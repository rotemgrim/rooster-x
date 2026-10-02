package engine

import "time"

const (
	sampleEvery     = time.Second
	saveTotalsEvery = 30 // samples
)

// sampleLoop measures transfers every second, applies the seeding limits and
// download queue, and writes the session file when it changed.
func sampleLoop() {
	defer close(samplerDone)
	tick := time.NewTicker(sampleEvery)
	defer tick.Stop()
	for n := 1; ; n++ {
		select {
		case <-stopSampling:
			return
		case <-tick.C:
		}
		for _, hash := range sample(time.Now(), n%saveTotalsEvery == 0) {
			endSeeding(hash)
		}
		flushSession()
	}
}

// sample updates every torrent's speeds and totals, stamps completions,
// reconciles transfers and returns the torrents that reached a seeding limit.
func sample(now time.Time, saveTotals bool) (seeded []string) {
	mu.Lock()
	defer mu.Unlock()
	for hash, e := range sessions {
		t := e.live.t
		stats := t.Stats()
		down, up := stats.BytesReadUsefulData.Int64(), stats.BytesWrittenData.Int64()
		e.live.downSpeed = smoothSpeed(e.live.downSpeed, down-e.live.lastDown)
		e.live.upSpeed = smoothSpeed(e.live.upSpeed, up-e.live.lastUp)
		e.live.lastDown, e.live.lastUp = down, up
		e.Downloaded, e.Uploaded = e.live.baseDown+down, e.live.baseUp+up

		if !isComplete(t) {
			continue
		}
		// torrents that finished before this was tracked get the time they
		// were first seen finished, like AddedAt
		if e.CompletedAt == 0 {
			e.CompletedAt = now.Unix()
			dirty = true
		}
		if !e.Paused && seedingDone(settings, e, t.BytesCompleted(), now) {
			seeded = append(seeded, hash)
		}
	}
	reconcileAllLocked() // torrents that just finished free their queue slots
	if saveTotals {
		dirty = true
	}
	return seeded
}

// smoothSpeed averages over the last few seconds so the numbers don't jump.
func smoothSpeed(prev float64, bytes int64) float64 {
	v := prev*0.6 + float64(bytes)/sampleEvery.Seconds()*0.4
	if v < 1 {
		return 0
	}
	return v
}
