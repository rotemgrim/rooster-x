import "./web-components/LibmediaPlayer";

/**
 * Standalone page for <libmedia-player>, opened as /player.html?src=&name=.
 *
 * It's a separate page so the server can send COOP/COEP headers for it
 * alone: that makes it cross-origin isolated (SharedArrayBuffer, so libmedia
 * decodes on multiple threads) without blocking the cross-origin posters
 * and fonts the main app loads.
 */
const params = new URLSearchParams(location.search);
const player = document.createElement("libmedia-player");
player.src = params.get("src") || "";
player.name = params.get("name") || "";
document.title = player.name || document.title;
player.addEventListener("close", () => {
    if (history.length > 1) {
        history.back();
    } else {
        location.href = "/";
    }
});
document.body.appendChild(player);
