import "reflect-metadata";
import {dialog} from "electron";
import * as readdirp from "readdirp";
import * as ptn from "../../common/lib/parse-torrent-name";
import {IEntry} from "../../common/models/IEntry";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import {Connection, In, Not} from "typeorm";
import {User} from "../../entity/User";
import {IFSEntry} from "../../common/models/IFSEntry";
import {getFileMd5} from "../helpers/Utils";
import {to} from "../../common/commonUtils";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import IMDBController from "./IMDBController";
import IMDBService from "../services/IMDBService";
import ConfigController from "./ConfigController";
import AppGlobal from "../helpers/AppGlobal";
import AppController from "./AppController";
import {Service} from "typedi";
import {MediaRepository} from "../repositories/MediaRepository";
import {InjectConnection} from "typeorm-typedi-extensions";
import {UserMetaData} from "../../entity/UserMetaData";
import {Genre} from "../../entity/Genre";
import * as _ from "lodash";

@Service()
export default class FilesController {

    @InjectConnection("reading")
    private connection: Connection;

    public static selectDbPathFolder(): Promise<any> {
        return new Promise((resolve, reject) => {
            dialog.showOpenDialog({
                properties: ["openDirectory"],
            }, (dirs) => {
                if (dirs) {
                    const config = AppGlobal.getConfig();
                    config.dbPath = dirs[0];
                    ConfigController.updateConfig(config)
                        .then(() => {
                            AppGlobal.setConfig(config);
                            AppController.bootstrapApp();
                        })
                        .then(() => resolve(dirs[0]))
                        .catch(e => {
                            console.error("could not save new config", e);
                            reject("could not save new config");
                        });
                } else {
                    reject("must select a folder");
                }
            });
        });
    }

    public doFullSweep(directory: string): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const entries = await FilesController.getAllVideos(directory);
            console.log(entries.length);

            const mediaFiles: MediaFile[] = [];
            const filesRepo = this.connection.getRepository(MediaFile);
            const metaDataRepo = this.connection.getRepository(MetaData);
            const episodeRepo = this.connection.getRepository(Episode);
            const seriesArr: MetaData[] = await metaDataRepo.find({type: "series"});
            const moviesArr: MetaData[] = await metaDataRepo.find({type: "movie"});
            const episodesArr: Episode[] = await episodeRepo.find();
            const allFiles = await filesRepo.createQueryBuilder()
                .select(["MediaFile.id", "MediaFile.hash", "MediaFile.path"])
                .getMany();
            const allPaths = {};
            let allGenres: string[] = [];
            for (const f of allFiles) {
                allPaths[f.path] = {id: f.id, hash: f.hash};
            }
            for (const e of entries) {
                if (allPaths[e.sEntry.fullPath]) {
                    delete allPaths[e.sEntry.fullPath];
                    continue;
                }
                let file = new MediaFile();
                file.hash = e.sEntry.hash || "";
                file.path = e.sEntry.fullPath;
                file.raw = e.sEntry.name;
                file.year = e.mEntry.year;
                file.resolution = e.mEntry.resolution || "";
                file.quality = e.mEntry.quality || "";
                file.codec = e.mEntry.codec || "";
                file.audio = e.mEntry.audio || "";
                file.group = e.mEntry.group || "";
                file.region = e.mEntry.region || "";
                file.language = e.mEntry.language || "";
                file.extended = e.mEntry.extended || false;
                file.hardcoded = e.mEntry.hardcoded || false;
                file.proper = e.mEntry.proper || false;
                file.repack = e.mEntry.repack || false;
                file.wideScreen = e.mEntry.widescreen || false;
                file.downloadedAt = e.sEntry.stat.birthtime;

                if (e.mEntry.episode || e.mEntry.season) {
                    file.metaData = FilesController.getMetaData(seriesArr, e, "series");
                    file.episode = await this.getEpisode(file.metaData, episodesArr, e);
                } else {
                    file.metaData = FilesController.getMetaData(moviesArr, e, "movie");
                }

                delete allPaths[file.path];
                if (file.metaData.status === "not-scanned") {
                    await IMDBController.getMetaDataFromInternetByMediaFile(file)
                        .then(async (res) => {
                            file = res;
                            file.metaData.status = "omdb";
                        }).catch(async () => {
                            file.metaData.status = "failed";
                        });
                }

                // first save genres
                if (file.metaData.genres) {
                    const genres = file.metaData.genres.split(", ") as string[];
                    allGenres = allGenres.concat(genres);
                }

                // todo: figure out why we need to empty this before saving
                if (file.metaData.userMetaData) {
                    delete file.metaData.userMetaData;
                }
                await this.connection.manager.save(file);
                mediaFiles.push(file);
                console.log(mediaFiles.length);
            }

            try {
                const genres2 = _.uniq(allGenres);
                const DbExistingGenres = await this.connection.getRepository(Genre)
                    .find({where: {type: Not(In(genres2))}});
                const existingGenres = DbExistingGenres.map(o => o.type);
                // console.log("genres from files", genres2);
                // console.log("existing Genres", existingGenres);
                const newGenres = _.difference(genres2, existingGenres);
                console.log("new Genres", newGenres);
                const rows = newGenres.map(g => new Genre(g));
                await this.connection.manager.save(rows);
            } catch (e) {
                console.warn("cant save genres", e);
            }

            const idsToDelete: any[] = [];
            for (const i in allPaths) {
                if (allPaths.hasOwnProperty(i)) {
                    idsToDelete.push(allPaths[i].id);
                }
            }
            await filesRepo.createQueryBuilder()
                .delete().where("id IN (:...ids)", {ids: idsToDelete})
                .execute();
            // }).catch(console.error);
        });
    }

    public static getAllVideos(directory: string): Promise<IEntry[]> {
        return new Promise((resolve, reject) => {
            try {
                const entries: IEntry[] = [];
                const stream = readdirp({
                    root: directory,
                    fileFilter: ["*.mkv", "*.avi", "3g2", "*.3gp", "*.aaf", "*.asf", "*.avchd", "*.drc", "*.flv",
                        "*.m2v", "*.m4p", "*.m4v", "*.mng", "*.mov", "*.mp2", "*.mp4", "*.mpe", "*.mpeg", "*.mpg",
                        "*.mpv", "*.mxf", "*.nsv", "*.ogg", "*.ogv", "*.qt", "*.rm", "*.rmvb", "*.roq", "*.svi",
                        "*.vob", "*.webm", "*.wmv"],
                    directoryFilter: ["!.git", "!*samples", "!*modules", "!.*", "!subs"],
                });

                stream
                    .on("data", (sEntry: IFSEntry) => {
                        const mEntry: IMediaEntry = ptn(sEntry.name);
                        if (Object.keys(mEntry).length >= 4) {
                            console.log(mEntry);
                            entries.push({mEntry, sEntry});
                        }
                    })
                    .on("end", () => {
                        // console.info("calculating hashes");
                        // const promises = entries.map((e) => FilesController.calcEntryHash(e));
                        // Promise.all(promises).then(() => resolve(entries)).catch(e => {
                        //    console.error(e);
                        //    reject(e);
                        // });
                        resolve(entries);
                    })
                    .on("error", (e) => {
                        console.error(e);
                        reject(e);
                    });
            } catch (e) {
                reject(e);
            }
        });

    }

    public static calcEntryHash(e: IEntry): Promise<any> {
        return new Promise(async (resolve, reject) => {
            let hash; let err;
            [err, hash] = await to(getFileMd5(e.sEntry.fullPath));
            e.sEntry.hash = "";
            if (!err) {
                e.sEntry.hash = hash;
                resolve();
            } else {
                reject(err);
            }
        });
    }

    public static getMetaData(metaDataArr: MetaData[], e: IEntry, type: "series" | "movie"): MetaData {
        const tmpArr = metaDataArr.filter((s) => s.title === e.mEntry.title);
        if (tmpArr && tmpArr.length > 0) {
            return tmpArr[0];
        } else {
            const metaData = new MetaData();
            metaData.title = e.mEntry.title;
            metaData.type = type;
            metaDataArr.push(metaData);
            return metaData;
        }
    }

    public getEpisode(metaData: MetaData, episodesArr: Episode[], e: IEntry): Promise<Episode> {
        return new Promise(async (resolve) => {
            const tmpArr = episodesArr.filter((s) => {
                return s.metaData && s.metaData.title === e.mEntry.title
                    && s.season === e.mEntry.season
                    && s.episode === e.mEntry.episode;
            });
            if (tmpArr && tmpArr.length > 0) {
                resolve(tmpArr[0]);
            } else {
                const tmpEpisode = new Episode();
                tmpEpisode.title = e.mEntry.title;
                tmpEpisode.episode = e.mEntry.episode || 0;
                tmpEpisode.season = e.mEntry.season;
                tmpEpisode.metaData = metaData;

                // check if series is watched
                const userMetaDataRepo = this.connection.manager.getRepository(UserMetaData);
                const userMetaData = await userMetaDataRepo.find({where: {metaDataId: metaData.id}});
                for (const umd of userMetaData) {
                    if (umd.isWatched === true) {
                        umd.isWatched = false;
                        await userMetaDataRepo.save(umd).catch(console.error);
                    }
                }

                IMDBController.getEpisodeMetaDataFromInternetByEpisode(tmpEpisode)
                    .then(ep => {
                        episodesArr.push(ep);
                        resolve(ep);
                    })
                    .catch(() => resolve(tmpEpisode));
            }
        });
    }
}
