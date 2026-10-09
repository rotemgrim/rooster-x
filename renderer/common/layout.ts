/** Screens this narrow get the phone layout. styles/mobile.css uses the same breakpoint. */
export const PHONE_QUERY = "(max-width: 700px)";

export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

/** Size of a library poster and the spacing around it, in px. */
export interface CardLayout {
    width: number;
    height: number;
    gap: number;
    perRow: number;
}

const POSTER_WIDTH = 224;
const POSTER_HEIGHT = 314;
const PHONE_COLUMNS = 3;

export function cardLayout(): CardLayout {
    if (isPhone()) {
        const gap = 8;
        // clientWidth, not innerWidth: while the icon font loads, icon names
        // render as wide text and phones grow innerWidth to fit them, then
        // shrink it back without a resize event, leaving room for 2 posters.
        const screenWidth = document.documentElement.clientWidth;
        // the gap also pads both edges of the row
        const width = Math.floor((screenWidth - (PHONE_COLUMNS + 1) * gap) / PHONE_COLUMNS);
        return {width, height: Math.round((width * POSTER_HEIGHT) / POSTER_WIDTH), gap, perRow: PHONE_COLUMNS};
    }
    const gap = 22.4;
    const available = window.innerWidth - 10;
    let perRow = Math.floor(available / POSTER_WIDTH);
    if (perRow * POSTER_WIDTH + (perRow - 1) * gap >= available) {
        perRow--;
    }
    return {width: POSTER_WIDTH, height: POSTER_HEIGHT, gap, perRow: Math.max(1, perRow)};
}

/** Publishes the poster size to CSS so the grid matches what the virtual scroller assumes. */
export function applyCardLayout(layout = cardLayout()) {
    const root = document.documentElement.style;
    root.setProperty("--card-w", `${layout.width}px`);
    root.setProperty("--card-h", `${layout.height}px`);
    root.setProperty("--card-gap", `${layout.gap}px`);
}
