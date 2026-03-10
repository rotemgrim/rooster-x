package tpb

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/dom"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/device"
)

var cookieExpiry = time.Now().Add(10 * time.Minute)

// Fetch opens a url with custom context and cookies passed by the caller.
// It uses ChromeDP under the hood in order to emulate a real browser.
func Fetch(ctx context.Context, url string, cookies []*http.Cookie) (string, []*http.Cookie, error) {
	var html string
	var newCookies []*http.Cookie

	ctx, cancel := chromedp.NewContext(ctx)
	defer cancel()

	err := chromedp.Run(ctx,
		setCookies(cookies),
		chromedp.Emulate(device.Pixel2XL),
		chromedp.Navigate(url),
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Retrieve HTML response.
			node, err := dom.GetDocument().Do(ctx)
			if err != nil {
				return err
			}
			html, err = dom.GetOuterHTML().WithNodeID(node.NodeID).Do(ctx)
			if err != nil {
				return err
			}

			// Retrieve response cookies using storage.GetCookies (replaces network.GetAllCookies)
			storageCookies, err := storage.GetCookies().Do(ctx)
			if err != nil {
				return err
			}

			newCookies = convertCookies(storageCookies)

			return nil
		}),
	)

	if err != nil {
		return "", nil, fmt.Errorf("could not download page: %w", err)
	}

	return html, newCookies, nil
}

// convertCookies converts ChromeDP cookies to Go http cookies.
func convertCookies(cookies []*network.Cookie) []*http.Cookie {
	var newCookies []*http.Cookie

	for _, cookie := range cookies {
		newCookie := http.Cookie{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Path:     cookie.Path,
			Domain:   cookie.Domain,
			Expires:  cookieExpiry,
			Secure:   cookie.Secure,
			HttpOnly: cookie.HTTPOnly,
		}
		newCookies = append(newCookies, &newCookie)
	}

	return newCookies
}

// FetchWaitFor opens a url and waits for a CSS selector to appear before returning the HTML.
// This is useful for pages with JavaScript challenges (e.g. AWS WAF) that need to complete before content loads.
func FetchWaitFor(ctx context.Context, url string, waitSelector string, timeout time.Duration) (string, error) {
	var html string

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	ctx, cancel = context.WithTimeout(ctx, timeout)
	defer cancel()

	actions := []chromedp.Action{
		chromedp.Emulate(device.Pixel2XL),
		chromedp.Navigate(url),
	}

	if waitSelector != "" {
		actions = append(actions, chromedp.WaitReady(waitSelector, chromedp.ByQuery))
	} else {
		actions = append(actions, chromedp.Sleep(5*time.Second))
	}

	actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
		node, err := dom.GetDocument().Do(ctx)
		if err != nil {
			return err
		}
		html, err = dom.GetOuterHTML().WithNodeID(node.NodeID).Do(ctx)
		return err
	}))

	err := chromedp.Run(ctx, actions...)
	if err != nil {
		return "", fmt.Errorf("could not fetch page with wait: %w", err)
	}

	return html, nil
}

// setCookies retrieves Go http cookies and sets ChromeDP out of it.
func setCookies(cookies []*http.Cookie) chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		for _, cookie := range cookies {
			expiry := cdp.TimeSinceEpoch(cookieExpiry)
			err := network.SetCookie(cookie.Name, cookie.Value).
				WithExpires(&expiry).
				WithDomain(cookie.Domain).
				WithPath(cookie.Path).
				WithHTTPOnly(cookie.HttpOnly).
				WithSecure(cookie.Secure).
				Do(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
