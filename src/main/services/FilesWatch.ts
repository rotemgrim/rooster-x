import * as path from "path";
import {app} from "electron";
import {EventEmitter} from "events";
import * as chokidar from "chokidar";

const directoryToListenTo = app.getPath("downloads");

export default class FilesWatch extends EventEmitter {

    private watcher: any;

    constructor() {
        super();
        setTimeout(() => this.startFilesWatch());
    }

    private startFilesWatch() {
        this.watcher = chokidar.watch(directoryToListenTo, {
            ignoreInitial: true,
            persistent: true,
        });

        this.watcher.on("add", (filePath) => {
            console.log(filePath);
            const fileName = path.basename(filePath);
            if (!fileName.startsWith("~") &&
                [".xlsx", ".xlsm", ".xlsb", ".xls", ".csv"].includes(path.extname(filePath))) {
                this.dispatchCommand(["file-downloaded", filePath]);
            }
        });
        console.info("Files watch listening on: " + directoryToListenTo);
    }

    private dispatchCommand(commandArr) {
        this.emit(commandArr[0], commandArr[1]);
    }

    public stopWatch() {
        console.info("stopped watching downloads folder");
        this.watcher.close();
    }
}
