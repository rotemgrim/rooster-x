import * as path from "path";
import {EventEmitter} from "events";
import * as chokidar from "chokidar";
import FilesController from "../controllers/FilesController";

export default class FilesWatch extends EventEmitter {

    private watcher: any;
    private readonly directoryToListenTo: string;

    constructor(directoryToListenTo: string) {
        super();
        this.directoryToListenTo = directoryToListenTo;
        setTimeout(() => this.startFilesWatch());
    }

    private startFilesWatch() {
        this.watcher = chokidar.watch(this.directoryToListenTo, {
            ignoreInitial: true,
            persistent: true,
        });

        this.watcher.on("add", (filePath) => {
            const fileName = path.basename(filePath);
            if (!fileName.startsWith("~") &&
                FilesController.includedExtensions.includes("*" + path.extname(filePath))) {
                this.dispatchCommand(["file-downloaded", filePath]);
            }
        });
        console.info("Files watch listening on: " + this.directoryToListenTo);
    }

    private dispatchCommand(commandArr) {
        this.emit(commandArr[0], commandArr[1]);
    }

    public stopWatch() {
        console.info("stopped watching downloads folder");
        this.watcher.close();
    }
}
