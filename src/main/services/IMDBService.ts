import axios from "axios";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.101 Safari/537.36";

export default class IMDBService {

    private static apiKey: string;

    public static setApiKey(key: string | undefined) {
        if (!IMDBService.apiKey && key) {
            IMDBService.apiKey = key;
        }
    }

    public static search(opt: IGetOptions): Promise<IOmdbSearchResult> {
        console.log("get query", opt);
        let url = `https://api.themoviedb.org/3/`;
        switch (opt.type) {
            case "movie": url += "movie/"; break;
            case "series": url += "tv/"; break;
            // case "episode": url += "tv/57532/season/1/episode/2?language=en-US' \\\n"; break;
        }

        url += `?query=${opt.title}`;
        url += `&include_adult=false`;
        url += `&language=en-US`;
        if (opt.year) { url += `&year=${opt.year}`; }

        url += `&api_key=${IMDBService.apiKey}`;

        console.log("tmdb url", url);
        return IMDBService.sendQuery("get", url);
    }

    public static get(opt: IGetOptions): Promise<IOmdbEntity> {
        console.log("get query", opt);
        let url = `http://www.omdbapi.com/?apikey=${IMDBService.apiKey}`;
        if (opt.imdbId) {url += `&i=${opt.imdbId}`; }
        else if (opt.title) {
            url += `&t=${opt.title}`;
            if (opt.type) {url += `&type=${opt.type}`; }// movie, series, episode
            if (opt.year) {url += `&y=${opt.year}`; }
        }
        if (opt.episode) {url += `&Episode=${opt.episode}`; }
        if (opt.season) {url += `&Season=${opt.season}`; }
        if (opt.plot) {url += `&plot=${opt.plot}`; }
        else {url += `&plot=full`; }
        console.log("omdb url", url);
        return IMDBService.sendQuery("get", url);
    }

    public static async sendQuery(method: string, url: string, data: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload = Object.assign({}, data);
            const headers: any = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "User-Agent": userAgent,
            };
            const config = {
                url: encodeURI(url),
                method,
                headers,
                data: payload,
                timeout: 60000,
            };

            axios.request(config).then(res => {
                if (res.data && res.data.Response === "True") {
                    resolve(res.data);
                } else if (res.data && res.data.Response === "False") {
                    console.warn("could not get response from omdb-api", res.data.Error);
                    console.warn("endpoint: " + method + " | " + url);
                    reject();
                } else {
                    console.warn("could not get response from omdb-api", res);
                    console.warn("endpoint: " + method + " | " + url);
                    reject();
                }
            }).catch(e => {
                if (e && e.response && e.response.status && e.response.data) {
                    console.warn("rest error: " + e.response.status, e.response.data);
                } else {
                    console.warn("rest error: " + e);
                }
                console.warn("endpoint: " + method + " | " + url);
                console.warn("payload: ", payload);
                reject(e);
            });
        });
    }
}

export interface IGetOptions {
    title?: string;
    year?: number;
    season?: number;
    episode?: number;
    plot?: "full" | "short";
    type?: "movie" | "series" | "episode";
    imdbId?: string;
}

export interface IOmdbEntity {
    Title: string;
    Year: string;
    Rated: string;
    Released: string;
    Season: string;
    Episode: string;
    Runtime: string;
    Genre: string;
    Director: string;
    Writer: string;
    Actors: string;
    Plot: string;
    Language: string;
    Country: string;
    Awards: string;
    Poster: string;
    Ratings: string;
    Metascore: string;
    imdbRating: string;
    imdbVotes: string;
    imdbID: string;
    seriesID: string;
    Type: "movie" | "series" | "episode" | "N/A";
    Response: string;
}

export interface IOmdbSearchEntity {
    Title: string;
    Year: string;
    Poster: string;
    imdbID: string;
    Type: "movie" | "series" | "episode" | "N/A";
}

export interface IOmdbSearchResult {
    Search: IOmdbSearchEntity[];
    totalResults: number;
    Response: string;
}
