import "reflect-metadata";
import * as readdirp from "readdirp";
import * as ptn from "../../common/lib/parse-torrent-name";
import {IEntry} from "../../common/models/IEntry";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import {createConnection} from "typeorm";
import {User} from "../../entity/User";
import {IFSEntry} from "../../common/models/IFSEntry";
import {getFileMd5} from "../helpers/Utils";
import {to} from "../../common/commonUtils";
import {Media} from "../../entity/Media";

export default class FilesController {

    public static doFullSweep(directory: string): Promise<any> {

        return new Promise(async (resolve, reject) => {
            const entries = await FilesController.getAllVideos(directory);
            console.log(entries.length);
            createConnection({
                type: "sqlite",
                database: "database.sqlite",
                entities: [
                    User,
                    Media,
                ],
                synchronize: true,
            }).then(async connection => {
                const mediaRows: Media[] = [];
                for (const e of entries) {
                    const media = new Media();
                    media.hash = e.sEntry.hash || "";
                    media.path = e.sEntry.fullPath;
                    media.raw = e.sEntry.name;

                    if (e.mEntry.episode || e.mEntry.season) {
                        media.type = "series";
                    } else {
                        media.type = "movie";
                    }
                    mediaRows.push(media);
                }
                await connection.manager.save(mediaRows);
            }).catch(console.error);
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
                        const mEntry: IMediaEntry = ptn(sEntry.name, sEntry.fullParentDir);
                        if (Object.keys(mEntry).length >= 4) {
                            console.log(mEntry);
                            entries.push({mEntry, sEntry});
                        }
                    })
                    .on("end", () => {
                        const promises = entries.map((e) => FilesController.calcEntryHash(e));
                        Promise.all(promises).then(() => resolve(entries));
                    });
            } catch (e) {
                reject(e);
            }
        });

    }

    public static calcEntryHash(e: IEntry): Promise<any> {
        return new Promise(async (resolve) => {
            let hash; let err;
            [err, hash] = await to(getFileMd5(e.sEntry.fullPath));
            e.sEntry.hash = "";
            if (!err) {
                e.sEntry.hash = hash;
            }
            resolve();
        });
    }
}
