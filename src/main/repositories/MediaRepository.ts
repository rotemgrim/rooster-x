import {Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import {UserMetaData} from "../../entity/UserMetaData";
import {User} from "../../entity/User";
import AppGlobal from "../helpers/AppGlobal";
import {AbsMetaData} from "../../entity/AbsMetaData";
import {UserEpisode} from "../../entity/UserEpisode";

@Service()
export class MediaRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public async getAllMedia() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find();

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

    public getMovies() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find({type: "movie"});
    }

    public getSeries() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find({type: "series"});
    }

    public setWatched(payload: {type: string, entityId: number, isWatched: boolean}) {
        return new Promise(async (resolve, reject) => {
            console.log(payload);
            const metaRepo = this.connection.manager.getRepository(payload.type);
            const userRepo = this.connection.manager.getRepository(User);
            const user = await userRepo.findOne(AppGlobal.getConfig().userId);
            const metaData = await metaRepo.findOne(payload.entityId) as AbsMetaData;

            if (user && metaData) {

                if (payload.type === "MetaData") {
                    const userMetaDataRepo = this.connection.manager.getRepository("UserMetaData");
                    let umd: any = await userMetaDataRepo.findOne({userId: user.id, metaDataId: metaData.id});
                    if (!umd) {
                        umd = new UserMetaData();
                        umd.user = user;
                        umd.metaData = metaData;
                    }
                    umd.isWatched = payload.isWatched;
                    userMetaDataRepo.save(umd).then(resolve).catch(reject);

                } else if (payload.type === "Episode") {
                    const userMetaDataRepo = this.connection.manager.getRepository("UserEpisode");
                    let umd: any = await userMetaDataRepo.findOne({userId: user.id, episodeId: metaData.id});
                    if (!umd) {
                        umd = new UserEpisode();
                        umd.user = user;
                        umd.episode = metaData;
                    }
                    umd.isWatched = payload.isWatched;
                    userMetaDataRepo.save(umd).then(resolve).catch(reject);

                }
            } else {
                reject();
            }
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
}
