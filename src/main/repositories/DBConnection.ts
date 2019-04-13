import {createConnection} from "typeorm";
import {User} from "../../entity/User";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import AppGlobal from "../helpers/AppGlobal";
import * as path from "path";
import {UserMetaData} from "../../entity/UserMetaData";
import {UserEpisode} from "../../entity/UserEpisode";

export default class DBConnection {

    public static async connect() {
        return new Promise(async (resolve, reject) => {
            const config = AppGlobal.getConfig();
            if (config.dbPath) {
                await createConnection({
                    name: "reading",
                    type: "sqlite",
                    database: path.join(config.dbPath, "database.sqlite"),
                    entities: [
                        User,
                        MediaFile,
                        MetaData,
                        Episode,
                        UserMetaData,
                        UserEpisode,
                    ],
                    synchronize: true,
                }).then(() => {
                    console.info("db connection made");
                    resolve();
                }).catch(e => {
                    console.error("could not connect to DB", e);
                    reject();
                });
            } else {
                console.error("could not connect to DB - there was no DB path provided");
                reject();
            }
        });
    }
}
