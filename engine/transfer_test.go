package engine

import (
	"fmt"
	"testing"
)

func TestQueueAndPause(t *testing.T) {
	startOfflineClient(t)
	settings.MaxActiveDownloads = 2
	oldest := addOfflineTorrent(t, 1, 100)
	middle := addOfflineTorrent(t, 2, 200)
	newest := addOfflineTorrent(t, 3, 300)

	want := func(hash string, queued bool, applied transfer) {
		t.Helper()
		mu.Lock()
		defer mu.Unlock()
		e := sessions[hash]
		if e.live.queued != queued || e.live.applied != applied {
			t.Errorf("%s: queued=%v applied=%+v, want queued=%v applied=%+v",
				hash[:4], e.live.queued, e.live.applied, queued, applied)
		}
	}
	both := transfer{down: true, up: true}
	uploadOnly := transfer{up: true}
	none := transfer{}

	want(oldest, false, both)
	want(middle, false, both)
	want(newest, true, uploadOnly) // beyond the limit: queued

	// pausing frees a slot for the queued torrent
	if err := SetPaused(oldest, true); err != nil {
		t.Fatal(err)
	}
	want(oldest, false, none)
	want(newest, false, both)

	// resuming takes the slot back, oldest first
	if err := SetPaused(oldest, false); err != nil {
		t.Fatal(err)
	}
	want(oldest, false, both)
	want(newest, true, uploadOnly)

	// removing frees a slot too
	if err := Remove(middle, false); err != nil {
		t.Fatal(err)
	}
	want(newest, false, both)
}

func TestAddPausedAndUnlimitedQueue(t *testing.T) {
	startOfflineClient(t)
	paused, err := add(sessionEntry{Magnet: fmt.Sprintf("magnet:?xt=urn:btih:%040x", 9), Paused: true})
	if err != nil {
		t.Fatal(err)
	}
	other := addOfflineTorrent(t, 10, 0)
	for hash, state := range map[string]State{paused: StatePaused, other: StateMetadata} {
		if s, err := Get(hash); err != nil || s.State != state || s.ETA != -1 {
			t.Errorf("Get(%s) = state %q eta %d err %v, want %q", hash[:4], s.State, s.ETA, err, state)
		}
	}
	if n := len(List()); n != 2 {
		t.Errorf("List has %d torrents, want 2", n)
	}
	mu.Lock()
	defer mu.Unlock()
	if got := sessions[paused].live.applied; got != (transfer{}) {
		t.Errorf("paused torrent applied %+v, want nothing allowed", got)
	}
	if e := sessions[other]; e.live.queued || e.live.applied != (transfer{down: true, up: true}) {
		t.Errorf("unlimited queue: queued=%v applied=%+v", e.live.queued, e.live.applied)
	}
}
