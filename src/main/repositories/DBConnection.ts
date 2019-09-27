import {createConnection} from "typeorm";
import {User} from "../../entity/User";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import AppGlobal from "../helpers/AppGlobal";
import * as path from "path";
import {UserMetaData} from "../../entity/UserMetaData";
import {UserEpisode} from "../../entity/UserEpisode";
import {Genre} from "../../entity/Genre";
import {TorrentFile} from "../../entity/TorrentFile";
import {Alias} from "../../entity/Alias";
import {app} from "electron";
import {copyDbFile} from "../helpers/miscFuncs";
import * as fs from "fs";

export default class DBConnection {

    public static async connect() {
        return new Promise(async (resolve, reject) => {
            const config = AppGlobal.getConfig();
            if (config.dbPath) {
                const localDb = path.join(app.getPath("appData"), "rooster-x", "db.sqlite");
                if (!fs.existsSync(localDb)) {
                    await copyDbFile();
                }
                await createConnection({
                    name: "reading",
                    type: "sqlite",
                    database: localDb,
                    entities: [
                        Alias,
                        User,
                        MediaFile,
                        MetaData,
                        Episode,
                        UserMetaData,
                        UserEpisode,
                        Genre,
                        TorrentFile,
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
