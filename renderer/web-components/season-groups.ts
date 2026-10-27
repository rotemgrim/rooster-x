import {html} from "lit";

/** The seasons an element shows folded. */
export class FoldedSeasons {
    private folded = new Set<number>();

    public constructor(private readonly host: {requestUpdate(): void}) {}

    public has(season: number) {
        return this.folded.has(season);
    }

    public toggle(season: number) {
        if (!this.folded.delete(season)) {
            this.folded.add(season);
        }
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
