package engine

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"
)

// scrapeTrackers are asked in parallel; each only sees part of a swarm, so
// the highest count per torrent is kept.
var scrapeTrackers = []string{
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
}

const (
	scrapeTimeout = 3 * time.Second
	// UDP trackers answer at most ~74 info hashes per scrape packet.
	scrapeBatch = 70
)

type PeerCounts struct {
	Seeders  int64
	Leechers int64
}

// Scrape asks the trackers for seeder/leecher counts of the given info
// hashes (hex). Hashes no tracker answered for are missing from the result.
func Scrape(hashes []string) map[string]PeerCounts {
	var ihs [][20]byte
	for _, h := range hashes {
		b, err := hex.DecodeString(h)
		if err != nil || len(b) != 20 {
			continue
		}
		ihs = append(ihs, [20]byte(b))
	}

	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		out = map[string]PeerCounts{}
	)
	for _, tr := range scrapeTrackers {
		for start := 0; start < len(ihs); start += scrapeBatch {
			batch := ihs[start:min(start+scrapeBatch, len(ihs))]
			wg.Add(1)
			go func(tr string, batch [][20]byte) {
				defer wg.Done()
				res, err := scrapeUDP(tr, batch, scrapeTimeout)
				if err != nil {
					log.Printf("scrape %s failed: %v", tr, err)
					return
				}
				mu.Lock()
				defer mu.Unlock()
				for i, r := range res {
					key := strings.ToUpper(hex.EncodeToString(batch[i][:]))
					cur := out[key]
					out[key] = PeerCounts{
						Seeders:  max(cur.Seeders, r.Seeders),
						Leechers: max(cur.Leechers, r.Leechers),
					}
				}
			}(tr, batch)
		}
	}
	wg.Wait()
	return out
}

// UDP tracker protocol (BEP 15) actions.
const (
	actionConnect uint32 = 0
	actionScrape  uint32 = 2
	actionError   uint32 = 3
	udpMagic      uint64 = 0x41727101980
)

// scrapeUDP runs one connect + scrape exchange with a udp:// tracker and
// returns the counts in the order of ihs.
func scrapeUDP(tracker string, ihs [][20]byte, timeout time.Duration) ([]PeerCounts, error) {
	u, err := url.Parse(tracker)
	if err != nil || u.Scheme != "udp" {
		return nil, fmt.Errorf("not a udp tracker: %s", tracker)
	}
	conn, err := net.DialTimeout("udp", u.Host, timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	req := binary.BigEndian.AppendUint64(nil, udpMagic)
	resp, err := udpRoundTrip(conn, req, actionConnect, nil, 16)
	if err != nil {
		return nil, err
	}
	connID := binary.BigEndian.Uint64(resp[8:16])

	req = binary.BigEndian.AppendUint64(nil, connID)
	var hashes []byte
	for _, ih := range ihs {
		hashes = append(hashes, ih[:]...)
	}
	resp, err = udpRoundTrip(conn, req, actionScrape, hashes, 8+12*len(ihs))
	if err != nil {
		return nil, err
	}
	out := make([]PeerCounts, len(ihs))
	for i := range out {
		row := resp[8+12*i:]
		// seeders, completed (downloads so far), leechers
		out[i] = PeerCounts{
			Seeders:  int64(binary.BigEndian.Uint32(row[0:4])),
			Leechers: int64(binary.BigEndian.Uint32(row[8:12])),
		}
	}
	return out, nil
}

// udpRoundTrip sends head + action + a fresh transaction id + body and
// returns a reply of at least minLen bytes for that transaction.
func udpRoundTrip(conn net.Conn, head []byte, action uint32, body []byte, minLen int) ([]byte, error) {
	var tx [4]byte
	_, _ = rand.Read(tx[:])
	req := binary.BigEndian.AppendUint32(head, action)
	req = append(append(req, tx[:]...), body...)
	if _, err := conn.Write(req); err != nil {
		return nil, err
	}
	buf := make([]byte, 2048)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	resp := buf[:n]
	if n < 8 || [4]byte(resp[4:8]) != tx {
		return nil, errors.New("bad tracker reply")
	}
	if got := binary.BigEndian.Uint32(resp[0:4]); got == actionError {
		return nil, fmt.Errorf("tracker error: %s", resp[8:])
	} else if got != action || n < minLen {
		return nil, errors.New("bad tracker reply")
	}
	return resp, nil
}
