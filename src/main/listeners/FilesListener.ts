
import FilesWatch from "../services/FilesWatch";
import AppGlobal from "../helpers/AppGlobal";
import FilesController from "../controllers/FilesController";
import {Container} from "typedi";
import * as path from "path";
import * as fs from "fs";
import {IWatchedRequest, MediaRepository} from "../repositories/MediaRepository";
import {uploadDbFile} from "../helpers/miscFuncs";

export default class FilesListener {

    private static watcher = {} as FilesWatch;
    private static isListening: boolean = false;

    public static startSweepInterval(directory, interval = 3600): void {
        setInterval(() => {
            console.info("starting a full sweep from interval");
            Container.get(FilesController).doFullSweep(directory)
                .catch(console.error);
        }, interval * 1000);
    }

    public static async startMergeDbInterval(directory, interval = 3600): Promise<any> {
        const messagesDirectory = path.join(directory, ".rooster");
        if (!fs.existsSync(messagesDirectory)) {
            fs.mkdirSync(messagesDirectory);
        }
        await FilesListener.mergeDb(messagesDirectory);
        setInterval(async () => {
            console.info("starting merging db requests");
            // mergeDb
            await FilesListener.mergeDb(messagesDirectory);
        }, interval * 1000);
    }

    public static init(): void {
        const dir = AppGlobal.getConfig().dbPath;
        if (!FilesListener.isListening) {
            if (dir) {
                FilesListener.watcher = new FilesWatch(dir);
                FilesListener.listen(FilesListener.watcher);
                FilesListener.isListening = true;
            } else {
                console.info("no directory is selected");
            }
        } else {
            console.info("already listening for download files");
        }
    }

    public static stopListen(): void {
        if (FilesListener.isListening) {
            FilesListener.watcher.stopWatch();
            FilesListener.isListening = false;
        }
    }

    private static listen(watcher: FilesWatch) {
        watcher.on("file-downloaded", async filePath => {
            console.log("a new file has been added", filePath);
            const fc = Container.get(FilesController);
            await fc.sweepFile(filePath);
        });
    }

    public static async mergeDb(dir) {
        const files: Array<{name: string, filePath: string, content: IWatchedRequest}> = [];
        fs.readdirSync(dir).forEach(filename => {
            const name = path.parse(filename).name;
            const filePath = path.resolve(dir, filename);
            const stat = fs.statSync(filePath);
            const isFile = stat.isFile();

            if (isFile) {
                const content = fs.readFileSync(filePath, {encoding: "utf8"});
                files.push({name, filePath, content: JSON.parse(content)});
            }
        });

        files.sort((a, b) => {
            // natural sort alphanumeric strings
            // https://stackoverflow.com/a/38641281
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        });

        let changes = 0;
        for (const f of files) {
            const tmp = f.name.split("-");
            switch (tmp[1]) {
                case "watched":
                    changes++;
                    const mediaRepo = Container.get(MediaRepository);
                    await mediaRepo.setWatched(f.content);
                    fs.unlinkSync(f.filePath);
                    break;
            }
        }

        if (changes > 0) {
            await uploadDbFile();
            console.log("files", files);
        }
    }
}
