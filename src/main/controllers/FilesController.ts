import "reflect-metadata";
import {dialog} from "electron";
import * as readdirp from "readdirp";
import * as ptn from "../../common/lib/parse-torrent-name";
import * as fs from "fs";
import * as path from "path";
import {IEntry} from "../../common/models/IEntry";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import {Connection, Repository} from "typeorm";
import {IFSEntry} from "../../common/models/IFSEntry";
import {getFileMd5} from "../helpers/Utils";
import {to} from "../../common/commonUtils";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import IMDBController from "./IMDBController";
import ConfigController from "./ConfigController";
import AppGlobal from "../helpers/AppGlobal";
import AppController from "./AppController";
import {Container, Service} from "typedi";
import {InjectConnection} from "typeorm-typedi-extensions";
import MediaController from "./MediaController";
import {IWatchedRequest, MediaRepository} from "../repositories/MediaRepository";
import WindowManager from "../services/WindowManager";
import {Alias} from "../../entity/Alias";
import {uploadDbFile} from "../helpers/miscFuncs";

const test = ptn("The Archer.2017.HDRip.XViD.AC3-ETRG.avi");
console.log("test", test);

@Service()
export default class FilesController {

    public static includedExtensions = ["*.mkv", "*.avi", "3g2", "*.3gp", "*.aaf", "*.asf", "*.avchd", "*.drc", "*.flv",
        "*.m2v", "*.m4p", "*.m4v", "*.mng", "*.mov", "*.mp2", "*.mp4", "*.mpe", "*.mpeg", "*.mpg",
        "*.mpv", "*.mxf", "*.nsv", "*.ogg", "*.ogv", "*.qt", "*.rm", "*.rmvb", "*.roq", "*.svi",
        "*.vob", "*.webm", "*.wmv"];

    private filesRepo: Repository<MediaFile>;
    private metaDataRepo: Repository<MetaData>;
    private episodeRepo: Repository<Episode>;
    private aliasRepo: Repository<Alias>;
    private isSweepStarted: boolean = false;

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

    constructor(
        @InjectConnection("reading") private connection: Connection,
    ) {
        this.filesRepo = this.connection.getRepository(MediaFile);
        this.metaDataRepo = this.connection.getRepository(MetaData);
        this.episodeRepo = this.connection.getRepository(Episode);
        this.aliasRepo = this.connection.getRepository(Alias);
    }

    public doFullSweep(directory: string): Promise<any> {
        return new Promise(async (resolve) => {

            if (this.isSweepStarted) {
                console.warn("cant start another sweep while sweep is running");
                resolve();
                return;
            }

            this.isSweepStarted = true;
            directory = path.resolve(directory);
            const entries = await FilesController.getAllVideos(directory);
            console.log("total entries", entries.length);
            if (entries.length === 0) {
                console.info("no entries found, cancel sweep");
                WindowManager.getMainWindow()
                    .send("sweep-update", {status: "", count: 0});
                this.isSweepStarted = false;
                resolve();
                return;
            }

            const mediaFiles: MediaFile[] = [];
            let seriesArr: MetaData[] = [];
            let moviesArr: MetaData[] = [];
            let episodesArr: Episode[] = [];
            let allFiles: MediaFile[] = [];
            await this.metaDataRepo.find({type: "series"})
                .then(res => seriesArr = res)
                .catch(e => console.error("could not get all series", e));
            await this.metaDataRepo.find({type: "movie"})
                .then(res => moviesArr = res)
                .catch(e => console.error("could not get all movies", e));
            await this.episodeRepo.find()
                .then(res => episodesArr = res)
                .catch(e => console.error("could not get all episodes", e));
            await this.filesRepo.createQueryBuilder()
                .select(["MediaFile.id", "MediaFile.hash", "MediaFile.path"])
                .getMany()
                .then(res => allFiles = res)
                .catch(e => console.error("could not get all files", e));

            const allPaths = {};
            let allGenres: string[] = [];
            for (const f of allFiles) {
                allPaths[f.path] = {id: f.id, hash: f.hash};
            }
            for (const e of entries) {
                const fullPath = e.sEntry.fullPath.toLowerCase();
                const isInAllPaths = allPaths[fullPath];
                if (isInAllPaths) {
                    delete allPaths[fullPath];
                    continue;
                }

                const file = await this.getFileAndMetaFromEntry(e, moviesArr, seriesArr, episodesArr);

                delete allPaths[file.path];

                // first save genres
                if (file.metaData.genres) {
                    const genres = file.metaData.genres.split(", ") as string[];
                    allGenres = allGenres.concat(genres);
                }

                // todo: figure out why we need to empty this before saving
                if (file.metaData && file.metaData.userMetaData) {
                    delete file.metaData.userMetaData;
                }
                if (file.episode && file.episode.userEpisode) {
                    delete file.episode.userEpisode;
                }
                await this.connection.manager.save(file)
                    .then(() => {
                        mediaFiles.push(file);
                        // console.log(mediaFiles.length);
                        WindowManager.getMainWindow()
                            .send("sweep-update", {status: "Getting data...",
                                count: mediaFiles.length + " of " + entries.length});
                    }).catch(err => {
                        console.error("could not save file " + file.raw, err);
                    });
            }

            await Container.get(MediaController).addGenres(allGenres)
                .catch(console.error);

            const idsToDelete: any[] = [];
            const dirStr = directory.toLowerCase();
            for (const i in allPaths) {
                if (allPaths.hasOwnProperty(i)) {
                    if (path.resolve(i).startsWith(dirStr)) {
                        idsToDelete.push(allPaths[i].id);
                    }
                }
            }
            if (idsToDelete.length > 0) {
                await this.filesRepo.createQueryBuilder()
                    .delete().where("id IN (:...ids)", {ids: idsToDelete})
                    .execute();
            }
            WindowManager.getMainWindow().send("sweep-update", {status: "", count: 0});
            await uploadDbFile();
            WindowManager.getMainWindow().send("refresh-media");
            this.isSweepStarted = false;
            resolve();
        });
    }

    public sweepFile(filePath: string) {
        return new Promise(async (resolve, reject) => {
            try {
                const sEntry = await this.getSEntry(filePath);
                const mEntry: IMediaEntry = ptn(sEntry.name);
                if (Object.keys(mEntry).length >= 4) {
                    console.log(mEntry);
                    let seriesArr: MetaData[] = [];
                    let moviesArr: MetaData[] = [];
                    let episodesArr: Episode[] = [];
                    if (mEntry.season && mEntry.episode) {
                        seriesArr = await this.metaDataRepo.find({type: "series"});
                        episodesArr = await this.episodeRepo.find();
                    } else {
                        moviesArr = await this.metaDataRepo.find({type: "movie"});
                    }
                    const file = await this.getFileAndMetaFromEntry({mEntry, sEntry},
                        moviesArr, seriesArr, episodesArr);

                    // save genres
                    if (file.metaData.genres) {
                        const genres = file.metaData.genres.split(", ") as string[];
                        await Container.get(MediaController).addGenres(genres)
                            .catch(console.error);
                    }

                    delete file.metaData.userMetaData;
                    await this.connection.manager.save(file);

                    resolve();
                } else {
                    console.info("no media entry was found in " + sEntry.name);
                    reject();
                }
            } catch (e) {
                console.error("could not sweep file " + filePath, e);
                reject();
            }
        });
    }

    public async getFileAndMetaFromEntry(
        e: IEntry,
        moviesArr: MetaData[],
        seriesArr: MetaData[],
        episodesArr: Episode[],
    ): Promise<MediaFile> {
        return new Promise(async (resolve) => {
            let file = new MediaFile();
            file.hash = e.sEntry.hash || "";
            file.path = e.sEntry.fullPath.toLowerCase();
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

            if (e.mEntry.episode && e.mEntry.season !== undefined) {
                file.metaData = await this.getMetaData(seriesArr, e, "series");
                const episode = await Container.get(MediaRepository).getEpisode(file.metaData, e.mEntry);
                episodesArr.push(episode);
                file.episode = episode;
            } else {
                file.metaData = await this.getMetaData(moviesArr, e, "movie");
            }

            if (!file.metaData.status) {
                file.metaData.status = await file.metaData.status;
            }
            // console.log("file.metaData.status2", file.metaData.status);
            if (file && file.metaData && file.metaData.status === "not-scanned") {
                await IMDBController.getMetaDataFromInternetByMediaFile(file)
                    .then(async (res) => {
                        file = res;
                        file.metaData.status = "omdb";
                        resolve(file);
                    }).catch(async () => {
                        file.metaData.status = "failed";
                        resolve(file);
                    });
            } else {
                resolve(file);
            }
        });
    }

    public static getAllVideos(directory: string): Promise<IEntry[]> {
        return new Promise((resolve, reject) => {
            try {
                const entries: IEntry[] = [];
                const stream = readdirp({
                    root: directory,
                    fileFilter: FilesController.includedExtensions,
                    directoryFilter: ["!.git", "!*samples", "!*sample", "!*modules", "!.*", "!subs"],
                });

                stream
                    .on("data", (sEntry: IFSEntry) => {
                        const mEntry: IMediaEntry = ptn(sEntry.name);
                        if (Object.keys(mEntry).length >= 5 && mEntry.title.length > 3
                            && !/^[0-9]{2,3}[\s|-|.|_]/.test(mEntry.title)) {
                            // console.log(mEntry);
                            entries.push({mEntry, sEntry});
                            // console.log(entries.length);
                            WindowManager.getMainWindow()
                                .send("sweep-update", {status: "Scanning files...", count: entries.length});
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

    public static async saveSetWatchedRequest(payload: IWatchedRequest, userId: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const config = AppGlobal.getConfig();
            if (config.dbPath) {
                const savePath = path.join(
                    config.dbPath, ".rooster",
                    `${(new Date()).getTime()}-watched-${userId}.json`,
                );
                payload.userId = userId;
                fs.writeFile(savePath, JSON.stringify(payload), "utf8", (err) => {
                    if (err) {
                        reject();
                    } else {
                        console.info("The watched request has been saved!");
                        resolve();
                    }
                });
            } else {
                console.error("no db path set");
                reject();
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

    public getMetaData(metaDataArr: MetaData[], e: IEntry, type: "series" | "movie"): Promise<MetaData> {
        return new Promise(async resolve => {
            const tmpArr = metaDataArr.filter((s) => s.title === e.mEntry.title);
            if (tmpArr && tmpArr.length > 0) {
                resolve(tmpArr[0]);
            } else {

                let md: MetaData | undefined;
                const alias = await this.aliasRepo.findOne({where: {alias: e.mEntry.title}});
                if (alias) {
                    md = alias.metaData;
                } else {
                    md = await this.metaDataRepo.findOne({where: {
                        title: e.mEntry.title,
                        type,
                    }});
                }

                if (md) {
                    metaDataArr.push(md);
                    resolve(md);
                    return;
                }

                const metaData = new MetaData();
                metaData.title = e.mEntry.title;
                metaData.type = type;
                metaDataArr.push(metaData);
                resolve(metaData);
            }
        });
    }

    private getSEntry(fileFullPath: string): Promise<IFSEntry> {
        return new Promise((resolve, reject) => {
            fs.lstat(fileFullPath, (err, stat) => {
                if (err) {
                    reject(err);
                } else {
                    const relPath = path.relative(fileFullPath, __dirname);
                    const relDir = path.dirname(relPath);
                    const realCurrentDir = path.dirname(fileFullPath);
                    resolve({
                        name:  path.basename(fileFullPath),
                        path:  relPath,   // relative to root
                        fullPath:  fileFullPath,
                        parentDir:  relDir,    // relative to root
                        fullParentDir:  realCurrentDir,
                        stat,
                    });
                }
            });
        });
    }
}
