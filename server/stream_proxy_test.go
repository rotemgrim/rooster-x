package server

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

// liveTV is a fake Xtream provider behind the stream proxy. The provider
// redirects every channel request to a new session, and serves a session's
// playlist only while it is the latest one, as a provider allowing one
// connection does.
type liveTV struct {
	providerHost string
	sessions     atomic.Int32 // opened by the provider
	proxyURL     string
	client       *http.Client // follows redirects like a browser
}

func newLiveTV(t *testing.T) *liveTV {
	tv := &liveTV{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/live/") {
			http.Redirect(w, r, fmt.Sprintf("/hls/index.m3u8?token=%d", tv.sessions.Add(1)), http.StatusFound)
			return
		}
		if r.URL.Query().Get("token") != fmt.Sprint(tv.sessions.Load()) {
			http.Error(w, "session ended", http.StatusForbidden)
			return
		}
		fmt.Fprint(w, "#EXTM3U\n#EXT-X-TARGETDURATION:4\nseg1.ts?token=1\n/hls/seg2.ts\nhttp://cdn.example/seg3.ts\n")
	}))
	t.Cleanup(provider.Close)
	SetXtreamConfig("u", "p", provider.URL)
	tv.providerHost = strings.TrimPrefix(provider.URL, "http://")

	mux := http.NewServeMux()
	mux.HandleFunc("/stream/", streamProxyHandler)
	mux.HandleFunc("/stream-ts/", streamRemoteHandler)
	proxy := httptest.NewServer(mux)
	t.Cleanup(proxy.Close)
	tv.proxyURL, tv.client = proxy.URL, proxy.Client()
	return tv
}

func (tv *liveTV) get(t *testing.T, u string) (*http.Response, string) {
	resp, err := tv.client.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

// open starts playing a channel, as the player does.
func (tv *liveTV) open(t *testing.T) (*http.Response, string) {
	return tv.get(t, tv.proxyURL+"/stream/live/u/p/7.m3u8")
}

func TestStreamProxyReloadsStayOnTheProviderSession(t *testing.T) {
	tv := newLiveTV(t)
	resp, _ := tv.open(t)
	// hls.js reloads the playlist at the URL it was redirected to
	reload := resp.Request.URL.String()
	if want := tv.proxyURL + "/stream-ts/" + tv.providerHost + "/hls/index.m3u8?token=1"; reload != want {
		t.Fatalf("redirected to %q, want %q", reload, want)
	}
	for i := 0; i < 3; i++ {
		if resp, body := tv.get(t, reload); resp.StatusCode != http.StatusOK || !strings.HasPrefix(body, "#EXTM3U") {
			t.Fatalf("reload %d: %d %q", i, resp.StatusCode, body)
		}
	}
	if n := tv.sessions.Load(); n != 1 {
		t.Fatalf("reloads opened %d provider sessions, want 1", n)
	}
}

func TestStreamProxyRestartOpensANewSession(t *testing.T) {
	tv := newLiveTV(t)
	first, _ := tv.open(t)
	tv.open(t)
	if n := tv.sessions.Load(); n != 2 {
		t.Fatalf("provider sessions = %d, want 2", n)
	}
	// the provider ended the first session, and the player sees it
	if resp, _ := tv.get(t, first.Request.URL.String()); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("ended session's playlist: %d, want 403", resp.StatusCode)
	}
}

func TestStreamProxyPointsPlaylistURLsThroughItself(t *testing.T) {
	tv := newLiveTV(t)
	_, body := tv.open(t)
	for _, want := range []string{
		"/stream-ts/" + tv.providerHost + "/hls/seg1.ts?token=1",
		"/stream-ts/" + tv.providerHost + "/hls/seg2.ts",
		"/stream-ts/cdn.example/seg3.ts",
	} {
		if !strings.Contains(body, want+"\n") {
			t.Errorf("playlist has no %q:\n%s", want, body)
		}
	}
}

func TestStreamRemotePathKeepsTheQuery(t *testing.T) {
	u, _ := url.Parse("http://cdn.example/a%20b/seg.ts?token=x&n=1")
	if got, want := streamRemotePath(u), "/stream-ts/cdn.example/a%20b/seg.ts?token=x&n=1"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
