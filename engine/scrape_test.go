package engine

import (
	"encoding/binary"
	"net"
	"reflect"
	"testing"
	"time"
)

// fakeTracker answers BEP 15 connect and scrape requests on loopback (so no
// firewall prompt), reporting seeders = first byte of the hash and
// leechers = second byte.
func fakeTracker(t *testing.T) string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 2048)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			req := buf[:n]
			action, tx := binary.BigEndian.Uint32(req[8:12]), req[12:16]
			resp := binary.BigEndian.AppendUint32(nil, action)
			resp = append(resp, tx...)
			switch action {
			case actionConnect:
				resp = binary.BigEndian.AppendUint64(resp, 42)
			case actionScrape:
				for ih := req[16:]; len(ih) >= 20; ih = ih[20:] {
					resp = binary.BigEndian.AppendUint32(resp, uint32(ih[0]))
					resp = binary.BigEndian.AppendUint32(resp, 0)
					resp = binary.BigEndian.AppendUint32(resp, uint32(ih[1]))
				}
			}
			_, _ = pc.WriteTo(resp, addr)
		}
	}()
	return "udp://" + pc.LocalAddr().String() + "/announce"
}

func TestScrapeUDP(t *testing.T) {
	tracker := fakeTracker(t)
	got, err := scrapeUDP(tracker, [][20]byte{{7, 3}, {12, 0}}, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	want := []PeerCounts{{Seeders: 7, Leechers: 3}, {Seeders: 12, Leechers: 0}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("scrape = %v, want %v", got, want)
	}
}

func TestScrapeKeysByUppercaseHash(t *testing.T) {
	old := scrapeTrackers
	scrapeTrackers = []string{fakeTracker(t)}
	t.Cleanup(func() { scrapeTrackers = old })

	hash := "0503000000000000000000000000000000000000"
	got := Scrape([]string{hash, "not-a-hash"})
	want := map[string]PeerCounts{"0503000000000000000000000000000000000000": {Seeders: 5, Leechers: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Scrape = %v, want %v", got, want)
	}
}
