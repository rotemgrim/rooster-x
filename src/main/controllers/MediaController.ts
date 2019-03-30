import {Connection, createConnection} from "typeorm";
import {User} from "../../entity/User";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";

function getConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
        createConnection({
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
        }).then(async connection => {
            console.info("db connection made");
            resolve(connection);
        }).catch(reject);
    });
}

export async function getAllMedia() {
    const con = await getConnection();
    const metaRepo = con.manager.getRepository(MetaData);
    return metaRepo.find();
}
