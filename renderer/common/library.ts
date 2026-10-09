import {type IFeedItem} from "./models/IFeedItem";
import {fromNow} from "./commonUtils";
import {searchByTitle} from "./search";

/**
 * What the library grid shows and how: a pure pipeline from the streamed
 * rows and the user's query to the (optionally grouped) list of cards.
 */

export type MediaType = "all" | "movies" | "series";

export type GroupBy = "none" | "genres" | "rating" | "resolution" | "year" | "uploadedDate" | "downloadedDate";

export interface OrderConfig {
    orderBy: keyof IFeedItem;
    groupBy: GroupBy;
    directionDescending: boolean;
    showUnwatchedFirst: boolean;
}

export interface FilterConfig {
    unwatchedMedia: boolean;
    noMediaWithoutFiles: boolean;
    /** Lowercase genre names; empty means every genre. Applied by the server. */
    noMediaWithoutGenres: string[];
    showDebug: boolean;
}

export interface LibraryQuery {
    /** The torrents library rather than the local folders one. */
    isTorrents: boolean;
    /** The side bar's All Media / Movies / Series choice. */
    mediaType: MediaType;
    /** Top bar search; while set, matches show best first, ungrouped. */
    search: string;
    filters: FilterConfig;
    order: OrderConfig;
}

/** The grid's cards: a flat list, or groups in display order. */
export type Library = IFeedItem[] | Map<string, IFeedItem[]>;

export const DEFAULT_FILTERS: FilterConfig = {
    unwatchedMedia: false,
    noMediaWithoutFiles: true,
    noMediaWithoutGenres: [],
    showDebug: false,
};

export const DEFAULT_ORDER: OrderConfig = {
    orderBy: "trendingCount",
    groupBy: "none",
    directionDescending: true,
    showUnwatchedFirst: true,
};

const NO_GROUP = "N/A";

export function arrangeLibrary(items: IFeedItem[], query: LibraryQuery): Library {
    const visible = items.filter(item => isVisible(item, query));
    if (query.search) {
        return searchByTitle(visible, query.search);
    }
    const {order} = query;
    if (!order.groupBy || order.groupBy === "none") {
        return sortItems(visible, order);
    }
    const groups = groupItems(visible, order);
    for (const [name, group] of groups) {
        groups.set(name, sortItems(group, order));
    }
    return groups;
}

function isVisible(item: IFeedItem, {isTorrents, mediaType, filters}: LibraryQuery): boolean {
    if (mediaType !== "all" && (item.type === "series") !== (mediaType === "series")) {
        return false;
    }
    if (filters.unwatchedMedia && item.isWatched) {
        return false;
    }
    // Torrent titles have no local files by definition.
    return isTorrents || !filters.noMediaWithoutFiles || !!item.mediaFileCount;
}

function groupItems(items: IFeedItem[], order: OrderConfig): Map<string, IFeedItem[]> {
    const byName = new Map<string, IFeedItem[]>();
    const add = (name: string, item: IFeedItem) => {
        const group = byName.get(name);
        group ? group.push(item) : byName.set(name, [item]);
    };

    if (order.groupBy === "genres") {
        for (const item of items) {
            for (const genre of item.genres ? item.genres.split(",") : []) {
                add(genre, item);
            }
        }
        // smallest genres first
        return new Map([...byName].sort(([, a], [, b]) => a.length - b.length));
    }

    const key = order.groupBy as keyof IFeedItem;
    for (const item of items) {
        add(item[key] == null ? NO_GROUP : String(item[key]), item);
    }
    const names = [...byName.keys()].filter(name => name !== NO_GROUP).sort((a, b) => (a > b ? 1 : -1));
    if (order.directionDescending) {
        names.reverse();
    }
    if (byName.has(NO_GROUP)) {
        names.push(NO_GROUP);
    }
    return new Map(names.map(name => [name, byName.get(name)!]));
}

function sortItems(items: IFeedItem[], order: OrderConfig): IFeedItem[] {
    const dirSign = order.directionDescending ? -1 : 1;
    // Tie-breaker chain: when the primary key is equal (e.g. items share
    // the same rating inside a group), fall back to release date, then
    // year, so the ordering is deterministic and "newest wins" instead
    // of random/insertion order.
    const tieKeys = (["released_unix", "year"] as const).filter(k => k !== order.orderBy);
    const compareKey = (a: IFeedItem, b: IFeedItem, key: keyof IFeedItem, sign: number) => {
        const av = a[key];
        const bv = b[key];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * sign : 1 * sign;
    };
    return items.slice().sort((a, b) => {
        if (order.showUnwatchedFirst) {
            const aw = a.isWatched ? 1 : 0;
            const bw = b.isWatched ? 1 : 0;
            if (aw !== bw) return aw - bw; // unwatched (0) first
        }
        const primary = compareKey(a, b, order.orderBy, dirSign);
        if (primary !== 0) return primary;
        for (const k of tieKeys) {
            const cmp = compareKey(a, b, k, -1); // always newest-first on ties
            if (cmp !== 0) return cmp;
        }
        return 0;
    });
}

/** A group's heading, from the group's name (the grouped field's value) and size. */
export function groupTitle(groupBy: GroupBy, name: string, count: number): string {
    if (!name || name === NO_GROUP) {
        return NO_GROUP;
    }
    switch (groupBy) {
        case "genres":
            return `${name} (${count})`;
        case "uploadedDate":
            return fromNow(name);
        case "downloadedDate":
            return new Date(name).toLocaleDateString();
        case "resolution":
            return name === "0" ? NO_GROUP : `${name}p`;
        default:
            return name;
    }
}

export function sameGenres(a: string[], b: string[]): boolean {
    return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** Absolute poster URL; the server sends TMDB-relative paths. */
export function posterUrl(poster: string): string {
    return poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w300${poster}`;
}

// Filters and order are saved per user and per library, so folders and
// torrents each keep their own.
const prefsKey = (kind: "filterConfig" | "orderConfig", isTorrents: boolean, userId: number) =>
    `${kind}-${isTorrents ? "torr" : "down"}-${userId}`;

function readPrefs<T>(key: string, defaults: T): T {
    const saved = localStorage.getItem(key);
    return saved ? {...defaults, ...JSON.parse(saved)} : defaults;
}

export function loadPrefs(isTorrents: boolean, userId: number): Pick<LibraryQuery, "filters" | "order"> {
    return {
        filters: readPrefs(prefsKey("filterConfig", isTorrents, userId), DEFAULT_FILTERS),
        order: readPrefs(prefsKey("orderConfig", isTorrents, userId), DEFAULT_ORDER),
    };
}

export function savePrefs({isTorrents, filters, order}: LibraryQuery, userId: number) {
    localStorage.setItem(prefsKey("filterConfig", isTorrents, userId), JSON.stringify(filters));
    localStorage.setItem(prefsKey("orderConfig", isTorrents, userId), JSON.stringify(order));
}
