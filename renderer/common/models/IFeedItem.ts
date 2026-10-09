/**
 * One row of the library grid, as streamed by "get-media"
 * (server/message_controller.go MediaDataExtended). Only the fields the
 * cards and the client-side filter/sort/group need; the details panel
 * fetches the full record when a card is opened.
 */
export interface IFeedItem {
    id: number;
    title: string;
    type: "movie" | "series";
    genres?: string;
    votes?: number;
    series?: boolean;
    rating?: number;
    year?: number;
    poster?: string;
    released_unix?: number;
    isWatched?: boolean;
    downloadedAt?: string;
    uploadedAt?: string;
    /** How many local files the title has (0 for torrent-only titles). */
    mediaFileCount?: number;
    quality?: string;
    resolution?: string;
    uploadedDate?: string;
    downloadedDate?: string;
    trendingCount?: number;
}
