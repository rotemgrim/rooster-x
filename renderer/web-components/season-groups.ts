import {html} from "lit";

const STORAGE_KEY = "rooster.foldedSeasons";

/** The folded seasons of every series and torrent, by their key. */
const saved: Record<string, number[]> = (() => {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_) {
        return {};
    }
})();

/**
 * The seasons an element shows folded, remembered in the browser under the
 * key of what it shows (a series, a torrent).
 */
export class FoldedSeasons {
    public constructor(private readonly host: {requestUpdate(): void}, private readonly key: () => string) {}

    public has(season: number) {
        return saved[this.key()]?.includes(season) ?? false;
    }

    public toggle(season: number) {
        const key = this.key();
        const folded = (saved[key] ?? []).filter(s => s !== season);
        if (!this.has(season)) {
            folded.push(season);
        }
        if (folded.length) {
            saved[key] = folded;
        } else {
            delete saved[key];
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch (_) {}
        this.host.requestUpdate();
    }
}

export interface SeasonListOptions<T> {
    season: (item: T) => number;
    label: (season: number) => string;
    item: (item: T) => unknown;
    folded: FoldedSeasons;
}

/**
 * Items, in their seasons' order, under a header per season that folds it;
 * just the items when they are all of one season.
 */
export function seasonList<T>(items: T[], o: SeasonListOptions<T>) {
    const groups = new Map<number, T[]>();
    for (const item of items) {
        const season = o.season(item);
        const group = groups.get(season);
        if (group) {
            group.push(item);
        } else {
            groups.set(season, [item]);
        }
    }
    if (groups.size < 2) {
        return items.map(item => o.item(item));
    }
    return [...groups].map(([season, seasonItems]) => {
        const open = !o.folded.has(season);
        return html`<button class="season-header" aria-expanded=${open} @click=${() => o.folded.toggle(season)}>
                <i class="material-icons">${open ? "expand_more" : "chevron_right"}</i>
                <span class="season-name">${o.label(season)}</span>
                <span class="season-count">${seasonItems.length} episode${seasonItems.length === 1 ? "" : "s"}</span>
            </button>
            ${open ? seasonItems.map(item => o.item(item)) : ""}`;
    });
}
