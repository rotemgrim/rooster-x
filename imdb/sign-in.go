package imdb

import (
	"context"
	"fmt"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/dom"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/device"
	"log"
	"net/http"
	"time"
)

func GetRecommendedList(username, password string) {
	// new cookies object
	cookies := make([]*http.Cookie, 0)

	_, _, err := signInToIMDb(context.Background(), cookies, username, password)
	if err != nil {
		log.Fatalf("Error signing in: %v", err)
	}

	var html string

	// navigate to the suggested page
	html, cookies, err = getRecommendedList(context.Background(), cookies)
	if err != nil {
		log.Fatalf("Error getting recommended list: %v", err)
	}

	fmt.Println(html)
}

func getRecommendedList(ctx context.Context, cookies []*http.Cookie) (string, []*http.Cookie, error) {
	//var html string
	var newCookies []*http.Cookie

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Headless,              // Run in headless mode
		chromedp.NoFirstRun,            // Skip first run tasks
		chromedp.NoDefaultBrowserCheck, // Disable default browser check
		chromedp.DisableGPU,            // Disable GPU usage for lower resources
	)
	allocCtx, cancel := chromedp.NewExecAllocator(ctx, opts...)

	ctx, cancel = chromedp.NewContext(allocCtx)
	defer cancel()

	var res string
	err := chromedp.Run(ctx,
		setCookies(ctx, cookies),
		chromedp.Emulate(device.Pixel2XL),
		chromedp.Navigate("https://www.imdb.com/what-to-watch/top-picks/"),
		chromedp.WaitVisible(`.ipc-page-grid`, chromedp.ByQuery),
		chromedp.OuterHTML(`.ipc-page-grid`, &res, chromedp.ByQuery),

		// extract the link to the sign-in page from the response
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Retrieve HTML response.
			//node, err := dom.GetDocument().Do(ctx)
			//if err != nil {
			//	return err
			//}
			//_, err = dom.GetOuterHTML().WithNodeID(node.NodeID).Do(ctx)
			//if err != nil {
			//	return err
			//}

			// Retrieve response cookies.
			newCDPCookies, err := network.GetCookies().Do(ctx)
			if err != nil {
				return err
			}

			newCookies = convertCookies(newCDPCookies)

			return nil
		}),
	)

	fmt.Println(res)

	if err != nil {
		return "", nil, fmt.Errorf("could not sign-in: %w", err)
	}

	return res, newCookies, nil
}

func signInToIMDb(ctx context.Context, cookies []*http.Cookie, email, pass string) (context.Context, []*http.Cookie,
	error) {
	//var html string
	var newCookies []*http.Cookie

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Headless,              // Run in headless mode
		chromedp.NoFirstRun,            // Skip first run tasks
		chromedp.NoDefaultBrowserCheck, // Disable default browser check
		chromedp.DisableGPU,            // Disable GPU usage for lower resources
	)
	allocCtx, cancel := chromedp.NewExecAllocator(ctx, opts...)

	ctx, cancel = chromedp.NewContext(allocCtx)
	defer cancel()

	var res string
	err := chromedp.Run(ctx,
		setCookies(ctx, cookies),
		chromedp.Emulate(device.Pixel2XL),
		chromedp.Navigate("https://www.imdb.com/registration/signin"),
		chromedp.WaitVisible(`#signin-options`, chromedp.ByID),
		chromedp.Click(`#signin-options a`, chromedp.ByQuery),
		chromedp.WaitVisible(`#ap_email`, chromedp.ByID),
		chromedp.SendKeys(`#ap_email`, email, chromedp.ByID),
		chromedp.SendKeys(`#ap_password`, pass, chromedp.ByID),
		chromedp.Click(`#signInSubmit`, chromedp.ByID),
		// extract the link to the sign-in page from the response
		chromedp.ActionFunc(func(ctx context.Context) error {
			// Retrieve HTML response.
			//node, err := dom.GetDocument().Do(ctx)
			//if err != nil {
			//	return err
			//}
			//_, err = dom.GetOuterHTML().WithNodeID(node.NodeID).Do(ctx)
			//if err != nil {
			//	return err
			//}

			// Retrieve response cookies.
			newCDPCookies, err := network.GetCookies().Do(ctx)
			if err != nil {
				return err
			}

			newCookies = convertCookies(newCDPCookies)

			return nil
		}),
	)

	fmt.Println(res)

	if err != nil {
		return ctx, nil, fmt.Errorf("could not sign-in: %w", err)
	}

	return ctx, newCookies, nil
}

// Fetch opens a url with custom context and cookies passed by the caller.
// It uses ChromeDP under the hood in order to emulate a real browser
// running on Pixel 2 XL, and thus properly handle Javascript.
func Fetch(ctx context.Context, url string, cookies []*http.Cookie) (string, []*http.Cookie, error) {
	var html string
	var newCDPCookies []*network.Cookie
	var newCookies []*http.Cookie

	ctx, cancel := chromedp.NewContext(ctx)
	defer cancel()

	// TODO(juliensalinas): check status code of the response
	err := chromedp.Run(ctx,
		setCookies(ctx, cookies),
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

			// Retrieve response cookies.
			newCDPCookies, err = network.GetCookies().Do(ctx)
			if err != nil {
				return err
			}

			newCookies = convertCookies(newCDPCookies)

			return nil
		}),
	)

	if err != nil {
		return "", nil, fmt.Errorf("could not download page: %w", err)
	}

	return html, newCookies, nil
}

var cookieExpiry = time.Now().Add(10 * time.Minute)

// setCookies retrieves Go http cookies and sets ChromeDP out of it.
//
// TODO(juliensalinas): try again to use network.SetCookies. Last
// time it failed with "invalid parameter -32602 for some reason".
func setCookies(ctx context.Context, cookies []*http.Cookie) chromedp.Action {
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

		// Check that cookies were properly set.
		cookiesInBrowser, err := network.GetCookies().Do(ctx)
		//cookiesInBrowser, err := network.GetAllCookies().Do(ctx)
		if err != nil {
			return err
		}
		if len(cookiesInBrowser) != len(cookies) {
			return fmt.Errorf("cookies not properly set")
		}

		return nil
	})
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
