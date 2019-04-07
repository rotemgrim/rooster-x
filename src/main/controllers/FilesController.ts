import "reflect-metadata";
import {dialog} from "electron";
import * as readdirp from "readdirp";
import * as ptn from "../../common/lib/parse-torrent-name";
import {IEntry} from "../../common/models/IEntry";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import {Connection} from "typeorm";
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
            // createConnection({
            //     type: "sqlite",
            //     database: "database.sqlite",
            //     entities: [
            //         User,
            //         MediaFile,
            //         MetaData,
            //         Episode,
            //     ],
            //     synchronize: true,
            // }).then(async connection => {

            console.info("db connection made");
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
            for (const f of allFiles) {
                allPaths[f.path] = {id: f.id, hash: f.hash};
            }
            for (const e of entries) {
                if (allPaths[e.sEntry.fullPath]) {
                    delete allPaths[e.sEntry.fullPath];
                    continue;
                }
                const file = new MediaFile();
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
                    file.episode = await FilesController.getEpisode(file.metaData, episodesArr, e);
                } else {
                    file.metaData = FilesController.getMetaData(moviesArr, e, "movie");
                }

                delete allPaths[file.path];

                await IMDBController.getMetaDataFromInternetByMediaFile(file)
                    .then(async (res) => {
                        mediaFiles.push(res);
                        res.metaData.status = "omdb";
                        await this.connection.manager.save(res);
                        console.log(mediaFiles.length);
                    }).catch(async () => {
                        mediaFiles.push(file);
                        file.metaData.status = "failed";
                        await this.connection.manager.save(file);
                        console.log(mediaFiles.length);
                    });
            }
            // await connection.manager.save(mediaFiles);

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

    public static getEpisode(metaData: MetaData, episodesArr: Episode[], e: IEntry): Promise<Episode> {
        return new Promise((resolve) => {
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
