import {Service} from "typedi";
import {Connection, In, Repository} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import {UserMetaData} from "../../entity/UserMetaData";
import {User} from "../../entity/User";
import AppGlobal from "../helpers/AppGlobal";
import {UserEpisode} from "../../entity/UserEpisode";
import {MediaFile} from "../../entity/MediaFile";
import IMDBController from "../controllers/IMDBController";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import {Alias} from "../../entity/Alias";
import {TorrentFile} from "../../entity/TorrentFile";
import FilesController from "../controllers/FilesController";
import {copyDbFile} from "../helpers/miscFuncs";

export interface IWatchedRequest {
    type: string;
    entityId: number;
    isWatched: boolean;
    userId?: number;
}

@Service()
export class MediaRepository {

    private episodeRepo: Repository<Episode>;
    private metaRepo: Repository<MetaData>;
    private aliasRepo: Repository<Alias>;
    private filesRepo: Repository<MediaFile>;
    private torrentFileRepo: Repository<TorrentFile>;

    constructor(
        @InjectConnection("reading") private connection: Connection,
    ) {
        this.episodeRepo = this.connection.getRepository(Episode);
        this.metaRepo = this.connection.getRepository(MetaData);
        this.aliasRepo = this.connection.getRepository(Alias);
        this.filesRepo = this.connection.getRepository(MediaFile);
        this.torrentFileRepo = this.connection.getRepository(TorrentFile);
    }

    public async getAllMedia() {
        console.info("getting all media");
        await copyDbFile();
        return this.metaRepo.find();

        // const userId = AppGlobal.getConfig().userId;
        // const sql = this.connection.manager
        //     .getRepository(MetaData)
        //     .createQueryBuilder("metaData")
        //     .select("metaData.title")
        //     .where("metaData.id = 4")
        //     .leftJoinAndSelect(UserMetaData,
        //         "userMetaData", "userMetaData.metaDataId = metaData.id",
        //         {userId});

        // console.log(sql.getSql());
        // const t = await sql.getRawAndEntities();
        // if (t) {
        //     console.log(t.raw);
        //     const w = await t.entities[0].userMetaData;
        //     console.log(w);
        // }
        // return sql.getRawAndEntities();
    }

    public async getAllTorrents() {
        return this.metaRepo.find();
    }

    public getMovies() {
        return this.metaRepo.find({type: "movie"});
    }

    public getSeries() {
        return this.metaRepo.find({type: "series"});
    }

    public getEpisodes(payload: {metaDataId: number}) {
        return new Promise(async (resolve) => {
            const metaData = await this.metaRepo.findOne(payload.metaDataId);
            const episodes = await this.episodeRepo.find({where: {metaData}});
            resolve(episodes);
        });
    }

    public getMetaData(payload: {id: number}) {
        return this.metaRepo.findOne(payload.id);
    }

    public getMetaDataByFileId(payload: {id: number}): Promise<MetaData|Episode> {
        return new Promise(async (resolve, reject) => {
            const fileRepo = this.connection.manager.getRepository(MediaFile);
            const mediaFile = await fileRepo.createQueryBuilder()
                .select(["mediaFile.metaDataId", "mediaFile.episodeId"])
                .where("mediaFile.id = :id", {id: payload.id})
                .getRawOne();
            console.log(mediaFile);

            let metaData: any;
            if (mediaFile && mediaFile.episodeId) {
                metaData = await this.connection.manager.getRepository(Episode).findOne(mediaFile.episodeId);
                metaData.metaData = await metaData.metaData;
            } else if (mediaFile && mediaFile.metaDataId) {
                metaData = await this.connection.manager.getRepository(MetaData).findOne(mediaFile.metaDataId);
            } else {
                reject();
                return;
            }

            if (metaData) {
                resolve(metaData);
            } else {
                reject();
            }
        });
    }

    public setWatched(payload: IWatchedRequest) {
        return new Promise(async (resolve, reject) => {
            console.debug("payload", payload);
            const metaRepo = this.connection.manager.getRepository(payload.type);
            const userRepo = this.connection.manager.getRepository(User);
            const metaData: any = await metaRepo.findOne(payload.entityId);

            let userId;
            if (payload.userId) {
                userId = payload.userId;
            } else {
                userId = AppGlobal.getConfig().userId;
                try {
                    await FilesController.saveSetWatchedRequest(payload, userId);
                } catch (err) {
                    console.error("could not save set watched request", err);
                }
            }
            const user = await userRepo.findOne(userId);

            if (user && metaData) {
                if (payload.type === "MetaData") {
                    this.setMetaDataWatched(metaData, user, payload.isWatched).then(resolve).catch(reject);
                } else if (payload.type === "Episode") {
                    this.setEpisodeWatched(metaData, user, payload.isWatched).then(resolve).catch(reject);
                }
            } else {
                reject();
            }
        });
    }

    private setMetaDataWatched(metaData: MetaData, user: User, isWatched: boolean) {
        return new Promise(async (resolve, reject) => {
            const userMetaDataRepo = this.connection.manager.getRepository("UserMetaData");
            let umd: any = await userMetaDataRepo.findOne({userId: user.id, metaDataId: metaData.id});
            if (!umd) {
                umd = new UserMetaData();
                umd.user = user;
                umd.metaData = metaData;
            } else if (umd.isWatched === isWatched) {
                resolve(isWatched);
                return;
            }
            umd.isWatched = isWatched;
            userMetaDataRepo.save(umd).then(() => resolve(isWatched)).catch(reject);
        });
    }

    private setEpisodeWatched(episode: Episode, user: User, isWatched: boolean) {
        return new Promise(async (resolve, reject) => {

            // set the episode with watched
            const userMetaDataRepo = this.connection.manager.getRepository("UserEpisode");
            let umd: any = await userMetaDataRepo.findOne({userId: user.id, episodeId: episode.id});
            if (!umd) {
                umd = new UserEpisode();
                umd.user = user;
                umd.episode = episode;
            } else if (umd.isWatched === isWatched) {
                resolve();
                return;
            }

            umd.isWatched = isWatched;
            const tmpSeries = await episode.metaData;
            userMetaDataRepo.save(umd)
                .then(() => this.checkIfSeriesIsWatchedForUser(tmpSeries.id, user.id))
                .then(isSeriesWatched => this.setMetaDataWatched(tmpSeries, user, isSeriesWatched))
                .then(isSeriesWatched => resolve({isSeriesWatched}))
                .catch(reject);
        });
    }

    public checkIfSeriesIsWatchedForUser(seriesId: number, userId: number): Promise<boolean> {
        return new Promise(async resolve => {
            const metaRepo = this.connection.manager.getRepository(MetaData);
            const series = await metaRepo.findOne(seriesId) as MetaData;
            const episodes = await series.episodes;
            const episodesIds = episodes.map(e => e.id);

            const userEpisodeRepo = this.connection.manager.getRepository(UserEpisode);
            const userEpisodes = await userEpisodeRepo.find({where: {episodeId: In(episodesIds), userId}});

            // check if all episodes in series are watched
            for (const e of episodes) {
                const ue = userEpisodes.filter(o => o.episodeId === e.id && o.isWatched);
                if (ue.length === 0) {
                    resolve(false);
                    return;
                }
            }
            resolve(true);
        });
    }

    public query(payload: {entity: string, query: any}): Promise<any> {
        const repository = payload.entity;
        const q = payload.query;
        console.log("query", repository);
        console.log("query", q);
        return new Promise((resolve, reject) => {
            this.connection.manager.getRepository(repository).find(q)
                .then(resolve)
                .catch(e => {
                    console.error("could not perform query", e);
                    reject();
                });
        });
    }

    public getEpisode(metaData: MetaData, mEntry: IMediaEntry): Promise<Episode> {
        return new Promise(async (resolve) => {
            const ep = await this.episodeRepo.findOne({where: {
                    metaData,
                    season: mEntry.season,
                    episode: mEntry.episode,
                }});
            if (ep) {
                resolve(ep);
                return;
            } else {
                const tmpEpisode = new Episode();
                tmpEpisode.title = mEntry.title;
                tmpEpisode.episode = mEntry.episode || 0;
                tmpEpisode.season = mEntry.season;
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
                    .then(episode => {
                        resolve(episode);
                    })
                    .catch(() => resolve(tmpEpisode));
            }
        });
    }

    public updateMetaDataById(payload: {imdbId: string, id: number}) {
        return new Promise(async (resolve, reject) => {
            const metaData: MetaData | undefined = await this.metaRepo.findOne(payload.id);
            if (metaData) {
                // if already metaData exists then do a replace for the files to that metaData
                const correctMetaData: MetaData | undefined =
                    await this.metaRepo.findOne({where: {imdbId: payload.imdbId}});
                if (correctMetaData) {
                    // do a replace and delete
                    for (const file of await metaData.mediaFiles) {
                        file.metaData = correctMetaData;
                        await this.filesRepo.update(file.id, file);
                    }
                    for (const file of await metaData.torrentFiles) {
                        file.metaData = correctMetaData;
                        await this.torrentFileRepo.update(file.id, file);
                    }
                    await this.saveAnAlias(correctMetaData, metaData.title);
                    await this.metaRepo.delete(metaData);
                } else {
                    // get the right metaData from internet and save it in the same place
                    IMDBController.getMetaDataFromInternetByImdbId(payload.imdbId)
                        .then(async data => {
                            const oldTitle = metaData.title;
                            IMDBController.IOmdbEntityToMetaData(metaData, data);
                            metaData.status = "omdb";
                            await this.metaRepo.save(metaData);

                            // if new title is different then add to aliases
                            await this.saveAnAlias(metaData, oldTitle);

                            if (metaData.type === "series") {
                                for (const ep of await metaData.episodes) {
                                    const omdbEntity = await IMDBController.getEpisodeMetaDataFromInternet(ep);
                                    if (omdbEntity) {
                                        IMDBController.IOmdbEntityToEpisode(ep, omdbEntity);
                                        await this.episodeRepo.save(ep);
                                    }
                                }
                            }
                            resolve(metaData);
                        }).catch(e => {
                        console.error("could not update metaData", e);
                        reject();
                    });
                }
            } else {
                console.error("could not update metaData", "metaData not found for update");
                reject();
            }
        });
    }

    private saveAnAlias(metaData: MetaData, oldTitle: string): Promise<any> {
        return new Promise(async (resolve) => {
            if (metaData.name.toLowerCase() !== oldTitle) {
                try {
                    const alias = new Alias();
                    alias.alias = oldTitle;
                    alias.realTitle = metaData.name;
                    alias.metaData = metaData;
                    await this.aliasRepo.save(alias);
                    resolve();
                } catch (e) {
                    console.info("could not save alias", e);
                    // do nothing
                    resolve();
                }
            } else {
                resolve();
            }
        });
    }
}
