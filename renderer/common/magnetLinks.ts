/**
 * RoosterX as the browser's handler for magnet: links. Once registered, the
 * browser opens a clicked link as the downloads view with the link in
 * MAGNET_PARAM, and the downloads page adds it.
 */

import {routePath} from "./routes";

const MAGNET_PARAM = "magnet";

// The API only exists on secure pages; an insecure one can still point to the HTTPS address.
const support: "ready" | "insecure" | "unsupported" =
    !window.isSecureContext ? "insecure" : "registerProtocolHandler" in navigator ? "ready" : "unsupported";

/** Whether to offer registering: false in browsers that have no handlers at all (phones). */
export const offersMagnetHandler = support !== "unsupported";

/** Makes RoosterX the handler, which the browser confirms with its own prompt; the reason when it can't. */
export function registerMagnetHandler(): string | null {
    if (support === "insecure") {
        return `Browsers only let secure pages open magnet links. Open RoosterX at https://${location.hostname}:8443 and try again.`;
    }
    try {
        navigator.registerProtocolHandler("magnet", `${location.origin}${routePath({view: "downloads"})}?${MAGNET_PARAM}=%s`);
        return null;
    } catch (err) {
        return `The browser won't let RoosterX open magnet links: ${err}`;
    }
}

/** The magnet link the browser opened the page with, taken out of the address so a reload doesn't add it again. */
export function takeLinkedMagnet(): string | null {
    const magnet = new URLSearchParams(location.search).get(MAGNET_PARAM);
    if (magnet) {
        history.replaceState(history.state, "", location.pathname);
    }
    return magnet;
}
