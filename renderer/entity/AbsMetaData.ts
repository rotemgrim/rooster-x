export interface AbsMetaData {

    id: number;

    title: string;

    /** id of the movie on imdb */
    imdbId?: string;

    /** id of the movie on imdb */
    tmdbId?: number;

    /** the genres that this movie belongs to */
    genres?: string;

    /** languages this movie was released in */
    languages?: string;

    /** countries this movie was released in */
    country?: string;

    /** votes received on imdb */
    votes?: number;

    /** whether or not this is a TV series */
    series?: boolean;

    /** the rating as it appears on imdb */
    rating?: number;

    /** the runtime of the movie */
    runtime?: number;

    /** year the movie was released */
    year?: number;

    /** link to the poster for this movie */
    poster?: string;

    /** score from a bunch of different review sites */
    metascore?: string;

    /** the plot (can either be long or short as specified in {@link MovieRequest}) */
    plot?: string;

    /** the directors of the movie */
    director?: string;

    /** writers of the movie */
    writer?: string;

    /** leading actors that starred in the movie */
    actors?: string;

    /** date that the movie was originally released */
    released?: string;

    /** date that the movie was originally released in unix format */
    released_unix?: number;

    trailer?: string;

    /** distributor / network (TV) or production company (movie) */
    network?: string;

    /** marketing tagline / one-liner */
    tagline?: string;

    /** backdrop / hero image path (relative TMDB path) */
    backdrop?: string;

    /** production status (e.g. Released, Returning Series, Ended) */
    productionStatus?: string;

    /** age rating / certification (e.g. PG-13, TV-MA) */
    ageRating?: string;

    /** enrichment state: NULL/"needed" / "ok" / "unavailable" */
    enrichState?: string;

    /** unix timestamp of last enrichment attempt */
    enrichedAt?: number;

}
