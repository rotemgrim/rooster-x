import {MediaFile} from "../../entity/MediaFile";
import AppGlobal from "../helpers/AppGlobal";
import {Episode} from "../../entity/Episode";
import IMDBService, {IGetOptions, IOmdbEntity, IOmdbSearchEntity} from "../services/IMDBService";
import {TorrentFile} from "../../entity/TorrentFile";
import {MetaData} from "../../entity/MetaData";

export default class IMDBController {

    public static getEpisodeMetaDataFromInternetByEpisode(episode: Episode): Promise<Episode> {
        return new Promise(async (resolve, reject) => {
            IMDBController.getEpisodeMetaDataFromInternet(episode)
                .then((data) => {
                    IMDBController.IOmdbEntityToEpisode(episode, data);
                    resolve(episode);
                }).catch(e => {
                    console.warn("NOT FOUND Episode: " + episode.metaData.title +
                        " S" + episode.season + " - E" + episode.episode);
                    reject(e);
                });
        });
    }

    public static IOmdbEntityToEpisode(episode: Episode, data: IOmdbEntity): Episode {
        if (data) {
            episode.title = data.Title;
            if (data.Runtime !== "N/A") {episode.runtime = IMDBController.extractRuntime(data.Runtime); }
            if (data.Poster !== "N/A") {episode.poster = data.Poster; }
            if (data.Plot !== "N/A") {episode.plot = data.Plot; }
            if (data.imdbID !== "N/A") {episode.imdbId = data.imdbID; }
            if (data.seriesID !== "N/A") {episode.imdbSeriesId = data.seriesID; }
            if (data.imdbVotes !== "N/A") {episode.votes = parseInt(data.imdbVotes.replace(/,/g, ""), 10); }
            if (data.imdbRating !== "N/A") {episode.rating = parseFloat(data.imdbRating); }
            if (data.Released !== "N/A") {
                episode.released = data.Released;
                episode.released_unix = new Date(data.Released).getTime() / 1000;
            }
        }
        return episode;
    }

    public static IOmdbEntityToMetaData(metaData: MetaData, data: IOmdbEntity): MetaData {
        if (metaData) {
            if (data.Title !== "N/A") {metaData.name = data.Title; }
            if (data.imdbID !== "N/A") {metaData.imdbId = data.imdbID; }
            if (data.Genre !== "N/A") {metaData.genres = data.Genre; }
            if (data.Language !== "N/A") {metaData.languages = data.Language; }
            if (data.Country !== "N/A") {metaData.country = data.Country; }
            if (data.imdbVotes !== "N/A") {
                metaData.votes = parseInt(data.imdbVotes.replace(/,/g, ""), 10);
            }
            if (data.Type !== "N/A") {metaData.type = data.Type; }
            if (data.imdbRating !== "N/A") {metaData.rating = parseFloat(data.imdbRating); }
            if (data.Runtime !== "N/A") {metaData.runtime = IMDBController.extractRuntime(data.Runtime); }
            if (data.Year !== "N/A") {metaData.year = parseInt(data.Year, 10); }
            if (data.Poster !== "N/A") {metaData.poster = data.Poster; }
            if (data.Metascore !== "N/A") {metaData.metascore = data.Metascore; }
            if (data.Plot !== "N/A") {metaData.plot = data.Plot; }
            if (data.Director !== "N/A") {metaData.director = data.Director; }
            if (data.Writer !== "N/A") {metaData.writer = data.Writer; }
            if (data.Actors !== "N/A") {metaData.actors = data.Actors; }
            if (data.Released !== "N/A") {
                metaData.released = data.Released;
                metaData.released_unix = new Date(data.Released).getTime() / 1000;
            }
            // file.metaData.trailer = data.trailer;
        }
        return metaData;
    }

    public static getMetaDataFromInternetByImdbId(imdbId: string): Promise<IOmdbEntity> {
        return new Promise((resolve, reject) => {
            IMDBController.getMetaDataFromInternet({imdbId})
                .then(data => {
                    resolve(data);
                }).catch(e => {
                    console.warn("could not get metaData by imdbId");
                    reject(e);
                });
        });
    }

    public static getMetaDataFromInternetByMediaFile<T>(file: MediaFile | TorrentFile): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload = {title: file.metaData.title, year: file.year, type: file.metaData.type};
            IMDBController.getMetaDataFromInternet(payload)
                .then((data) => {
                    IMDBController.IOmdbEntityToMetaData(file.metaData, data);
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

    public static searchMetaDataFromInternet(payload):
    Promise<any> {
        return new Promise((resolve, reject) => {
            IMDBService.setApiKey(AppGlobal.getConfig().tmdbApiKey);
            IMDBService.search(payload).then(res => {
                const answerArr: IOmdbSearchEntity[] = [];
                if (res.Response === "True" && res.Search.length > 0)  {
                    for (const entry of res.Search) {
                        answerArr.push(entry);
                    }
                }
                resolve(answerArr);
            }).catch(reject);
        });
    }

    public static getMetaDataFromInternet(payload: IGetOptions): Promise<IOmdbEntity> {
        return new Promise((resolve, reject) => {
            IMDBService.setApiKey(AppGlobal.getConfig().tmdbApiKey);
            IMDBService.get(payload).then(resolve).catch(reject);
        });
    }

    public static getEpisodeMetaDataFromInternet(episode: Episode): Promise<IOmdbEntity> {
        return new Promise(async (resolve, reject) => {
            if (!episode || !episode.season || !episode.episode) {
                reject();
            } else {
                const metaData = await episode.metaData;
                let payload: IGetOptions = {
                    title: metaData.title,
                    season: episode.season,
                    episode: episode.episode,
                    type: "episode",
                };
                if (metaData.imdbId) {
                    payload = Object.assign(payload, {imdbId: metaData.imdbId});
                }
                IMDBService.setApiKey(AppGlobal.getConfig().tmdbApiKey);
                IMDBService.get(payload).then(resolve).catch(reject);
            }
        });
    }
}
