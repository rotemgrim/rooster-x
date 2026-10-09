/** A list, as "get-lists" returns it (server/lists_controller.go List). */
export interface IListRow {
    id: number;
    userId: number;
    name: string;
    createdAt: number;
    updatedAt: number;
    itemCount: number;
    /** Up to 5 TMDB poster paths, most recently added first. */
    posters: string[] | null;
}

/** One list entry, as "get-list-items" returns it (ListItemRow); nullable columns arrive as null. */
export interface IListItemRow {
    id: number;
    listId: number;
    metaDataId: number;
    position: number;
    addedAt: number;
    title: string | null;
    year: number | null;
    poster: string | null;
    type: string | null;
    series: boolean | null;
    rating: number | null;
    isWatched: boolean | null;
    episodesTotal: number;
    episodesWatched: number;
    moviePercent: number | null;
    movieFinished: boolean | null;
}
