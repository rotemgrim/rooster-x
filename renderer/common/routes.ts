/**
 * The app's URLs, one format in one place:
 *   /<view>                              a view
 *   /<view>/<movie|series|tv|episode>/<id>   a card opened in a library view
 *   /lists/<listId>[/<type>/<id>]        a list, optionally with a card opened
 */

import {isLimited, type User} from "../entity/User";

export const VIEWS = ["folders", "torrents", "channels", "lists", "downloads"] as const;
export type View = typeof VIEWS[number];
export const isView = (v: unknown): v is View => VIEWS.includes(v as View);

/** Profiles with an age limit have no downloads. */
export const viewAllowed = (view: View, user: User) => view !== "downloads" || !isLimited(user);

/** Views that render their own page instead of the media grid, so they don't stream the media dataset. */
export const PAGE_VIEWS: ReadonlySet<View> = new Set<View>(["channels", "lists", "downloads"]);

export interface Route {
    view: View;
    /** The list shown, for the lists view. */
    listId?: number;
    /** The card whose details are open. */
    card?: {type: "movie" | "series", id: number};
}

const ROUTE_PATH = /^\/([a-z]+)(?:\/(\d+))?(?:\/(movie|series|tv|episode)\/(\d+))?\/?$/;

/** The route for a URL path, or null when the path isn't one of the app's routes. */
export function parseRoute(path: string): Route | null {
    const m = path.match(ROUTE_PATH);
    if (!m) {
        return null;
    }
    const [, view, listId, type, id] = m;
    const isList = view === "lists";
    // a list id only after /lists, and a card in the lists view only inside a list
    if (!isView(view) || (listId && !isList) || (isList && type && !listId)) {
        return null;
    }
    return {
        view,
        ...(listId ? {listId: Number(listId)} : {}),
        // older links also say tv/episode; the details panel only tells series from movies
        ...(type ? {card: {type: type === "series" ? "series" : "movie", id: Number(id)}} : {}),
    };
}

export function routePath({view, listId, card}: Route): string {
    return `/${view}${listId ? `/${listId}` : ""}${card ? `/${card.type}/${card.id}` : ""}`;
}
