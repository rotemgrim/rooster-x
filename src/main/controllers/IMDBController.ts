import {MediaFile} from "../../entity/MediaFile";
import AppGlobal from "../helpers/AppGlobal";
import {Episode} from "../../entity/Episode";
import IMDBService, {IOmdbEntity} from "../services/IMDBService";
import {TorrentFile} from "../../entity/TorrentFile";

export default class IMDBController {

    public static getEpisodeMetaDataFromInternetByEpisode(episode: Episode): Promise<Episode> {
        return new Promise(async (resolve, reject) => {
            IMDBController.getEpisodeMetaDataFromInternet(episode)
                .then((data) => {
                    episode.title = data.Title;
                    if (data.Runtime !== "N/A") {episode.runtime = IMDBController.extractRuntime(data.Runtime); }
                    if (data.Poster !== "N/A") {episode.poster = data.Poster; }
                    if (data.Plot !== "N/A") {episode.plot = data.Plot; }
                    if (data.Released !== "N/A") {episode.released = data.Released; }
                    if (data.imdbID !== "N/A") {episode.imdbId = data.imdbID; }
                    if (data.seriesID !== "N/A") {episode.imdbSeriesId = data.seriesID; }
                    if (data.imdbVotes !== "N/A") {episode.votes = parseInt(data.imdbVotes.replace(/,/g, ""), 10); }
                    if (data.imdbRating !== "N/A") {episode.rating = parseFloat(data.imdbRating); }
                    resolve(episode);
                }).catch(e => {
                    console.warn("NOT FOUND Episode: " + episode.metaData.title +
                        " S" + episode.season + " - E" + episode.episode);
                    reject(e);
                });
        });
    }

    public static getMetaDataFromInternetByMediaFile<T>(file: MediaFile | TorrentFile): Promise<any> {
        return new Promise((resolve, reject) => {
            IMDBController.getMetaDataFromInternet(file.metaData.title, file.year, file.metaData.type)
                .then((data) => {
                    if (data.Title !== "N/A") {file.metaData.name = data.Title; }
                    if (data.imdbID !== "N/A") {file.metaData.imdbId = data.imdbID; }
                    if (data.Genre !== "N/A") {file.metaData.genres = data.Genre; }
                    if (data.Language !== "N/A") {file.metaData.languages = data.Language; }
                    if (data.Country !== "N/A") {file.metaData.country = data.Country; }
                    if (data.imdbVotes !== "N/A") {
                        file.metaData.votes = parseInt(data.imdbVotes.replace(/,/g, ""), 10);
                    }
                    if (data.Type !== "N/A") {file.metaData.type = data.Type; }
                    if (data.imdbRating !== "N/A") {file.metaData.rating = parseFloat(data.imdbRating); }
                    if (data.Runtime !== "N/A") {file.metaData.runtime = IMDBController.extractRuntime(data.Runtime); }
                    if (data.Year !== "N/A") {file.metaData.year = parseInt(data.Year, 10); }
                    if (data.Poster !== "N/A") {file.metaData.poster = data.Poster; }
                    if (data.Metascore !== "N/A") {file.metaData.metascore = data.Metascore; }
                    if (data.Plot !== "N/A") {file.metaData.plot = data.Plot; }
                    if (data.Director !== "N/A") {file.metaData.director = data.Director; }
                    if (data.Writer !== "N/A") {file.metaData.writer = data.Writer; }
                    if (data.Actors !== "N/A") {file.metaData.actors = data.Actors; }
                    if (data.Released !== "N/A") {file.metaData.released = data.Released; }
                    // file.metaData.trailer = data.trailer;
                    resolve(file);
            }).catch(e => {
                console.warn("NOT FOUND: " + file.raw);
                reject(e);
            });
        });
    }

    public static extractRuntime(runtimeStr: string): number {
        if (runtimeStr && runtimeStr === "N/A") {
            return 0;
        }
        if (runtimeStr && runtimeStr.endsWith("min")) {
            const tmp = runtimeStr.split(" min");
            return parseInt(tmp[0], 10);
        }
        if (runtimeStr) {
            return parseInt(runtimeStr, 10);
        }
        return 0;
    }

    public static getMetaDataFromInternet(title: string, year?: number, type?: "movie" | "series" | "episode"):
        Promise<IOmdbEntity> {
        return new Promise((resolve, reject) => {
            IMDBService.setApiKey(AppGlobal.getConfig().omdbApiKey);
            IMDBService.get({title, year, type}).then(resolve).catch(reject);
        });
    }

    public static getEpisodeMetaDataFromInternet(episode: Episode): Promise<IOmdbEntity> {
        return new Promise(async (resolve, reject) => {
            if (!episode || !episode.season || !episode.episode) {
                reject();
            } else {
                const metaData = await episode.metaData;
                IMDBService.setApiKey(AppGlobal.getConfig().omdbApiKey);
                IMDBService.get({
                        title: metaData.title,
                        season: episode.season,
                        episode: episode.episode,
                        type: "episode"}).then(resolve).catch(reject);
            }
        });
    }
}
