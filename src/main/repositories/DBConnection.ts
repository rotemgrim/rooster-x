import {createConnection} from "typeorm";
import {User} from "../../entity/User";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";

export default class DBConnection {

    public static async connect() {
        return new Promise(async (resolve, reject) => {
            await createConnection({
                name: "reading",
                type: "sqlite",
                database: "database.sqlite",
                entities: [
                    User,
                    MediaFile,
                    MetaData,
                    Episode,
                ],
                synchronize: true,
            }).then(() => {
                console.info("db connection made");
                resolve();
            }).catch(e => {
                console.error("could not connect to DB", e);
                reject();
            });
        });
    }
}
