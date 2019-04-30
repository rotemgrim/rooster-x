
import FilesWatch from "../services/FilesWatch";
import AppGlobal from "../helpers/AppGlobal";
import FilesController from "../controllers/FilesController";
import {Container} from "typedi";

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
}
