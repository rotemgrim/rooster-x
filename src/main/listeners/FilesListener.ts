
import FilesWatch from "../services/FilesWatch";

export default class FilesListener {

    private static watcher = {} as FilesWatch;
    private static isListening: boolean = false;

    public static init(): void {
        if (!FilesListener.isListening) {
            FilesListener.watcher = new FilesWatch();
            FilesListener.listen(FilesListener.watcher);
            FilesListener.isListening = true;
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
            console.log("a file been connected via auto file watch at: " + filePath);
        });
    }
}
