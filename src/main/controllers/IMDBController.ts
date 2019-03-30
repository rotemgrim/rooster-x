import * as imdb from "imdb-api";
import {Movie} from "imdb-api";
import {MediaFile} from "../../entity/MediaFile";
import AppGlobal from "../helpers/AppGlobal";

export default class IMDBController {

    public static getMetaDataFromInternetByMediaFile(file: MediaFile): Promise<MediaFile> {
        return new Promise((resolve, reject) => {
            IMDBController.getMetaDataFromInternet(file.metaData.title, file.year)
                .then((data) => {
                    file.metaData.name = data.name || data.title;
                    file.metaData.imdbid = data.imdbid;
                    file.metaData.imdburl = data.imdburl;
                    file.metaData.genres = data.genres;
                    file.metaData.languages = data.languages;
                    file.metaData.country = data.country;
                    file.metaData.votes = data.votes;
                    file.metaData.series = data.series;
                    file.metaData.rating = data.rating;
                    file.metaData.runtime = IMDBController.extractRuntime(data.runtime);
                    file.metaData.year = data.year;
                    file.metaData.poster = data.poster;
                    file.metaData.metascore = data.metascore;
                    file.metaData.plot = data.plot;
                    file.metaData.director = data.director;
                    file.metaData.writer = data.writer;
                    file.metaData.actors = data.actors;
                    file.metaData.released = data.released;
                    // file.metaData.trailer = data.trailer;
                    resolve(file);
            }).catch(reject);
        });
    }

    public static extractRuntime(runtimeStr: string): number {
        if (runtimeStr === "N/A") {
            return 0;
        }

        if (runtimeStr.endsWith("min")) {
            const tmp = runtimeStr.split(" min");
            return parseInt(tmp[0], 10);
        }

        return parseInt(runtimeStr, 10);
    }

    public static getMetaDataFromInternet(title: string, year?: number): Promise<Movie> {
        return new Promise((resolve, reject) => {
            imdb.get({name: title, year}, {
                apiKey: AppGlobal.getConfig().omdbApiKey,
            }).then(resolve).catch(reject);
        });
    }
}
