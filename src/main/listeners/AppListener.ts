import {app, ipcMain} from "electron";
import AppController from "../controllers/AppController";
import AppGlobal from "../helpers/AppGlobal";
import TrayBuilder from "../helpers/TrayBuilder";
import WindowManager from "../services/WindowManager";
import {MainPromiseIpc} from "../../common/lib/ipcPromise/MainPromiseIpc";
import {rendererLogger} from "../helpers/Logger";
import ZipperController from "../controllers/ZipperController";
import ConfigController from "../controllers/ConfigController";
import CommandListener from "./CommandListener";
import ProxyService from "../services/ProxyService";
import FilesListener from "./FilesListener";
import FilesController from "../controllers/FilesController";
declare const __static: any;

const promiseIpc = new MainPromiseIpc({ maxTimeoutMs: 10000 });

export default class AppListener {

    public static isListening: boolean = false;

    public static async init(): Promise<any> {
        AppGlobal.startTime = Date.now();
        AppGlobal.set("staticPath", __static);
        AppListener.listen();
    }

    public static listen(): void {
        app.on("window-all-closed", (e) => AppController.windowAllClosed(e));
        app.on("will-quit", e => AppController.willQuit(e));
        app.on("login", ProxyService.initProxySettings);
        app.on("ready", async () => {

            // from renderer -> ask to do stuff
            ipcMain.on("hide-me", (event) => WindowManager.hideSender(event));
            ipcMain.on("maximize-me", (event) => WindowManager.maximizeSender(event));
            ipcMain.on("original-size-me", (event) => WindowManager.originalSizeSender(event));
            ipcMain.on("set-icon", (e, status) => TrayBuilder.setIcon(status));
            ipcMain.on("change-win-height", (e, height) => WindowManager.changeSenderHeight(e, height));
            ipcMain.on("send-to-logger", (e, data) => rendererLogger(data));
            ipcMain.on("open-all-dev-tools", () => WindowManager.openDevTools());
            ipcMain.on("generate-logs", () => ZipperController.generateLogs());
            ipcMain.on("clear-cache", () => ZipperController.clearCache());
            ipcMain.on("quit-force", () => AppController.quit(true));
            ipcMain.on("logout-force", () => AppController.logout(true));

            promiseIpc.on("get-config", ConfigController.getConfigPromise);
            promiseIpc.on("save-config", ConfigController.updateConfigAndRestart);

            AppListener.isListening = true;
            AppListener.listenForProcessEvents();
            CommandListener.init();
            // TrayBuilder.init();
            if (AppGlobal.getConfig().autoSyncDownloadFolder) {
                FilesListener.init();
            }
            await AppController.preOpenWindows();
            await AppController.bootstrapApp();
            console.log("app is ready!");
            await FilesController.doFullSweep("u:\\videos");
            // FilesController.getAllVideos("Z:\\Complete\\Rotem");
            // FilesController.getAllVideos("Z:\\Complete\\Rotem\\[bonkai77] Fairy Tail [BD-1080p] [DUAL-AUDIO]
            // [x265] [HEVC] [AAC] [10bit]");
        });
        const interval = setInterval(() => {
            if (app.isReady() && !AppListener.isListening) {
                app.emit("ready");
            } else if (app.isReady()) {
                clearInterval(interval);
            }
        }, 100);
    }

    // private static on(channel: string, func: any) {
    //     ipcMain.on(channel, (...args) => {
    //         console.debug("ipcMain", channel);
    //         if (args && args.length > 0) {
    //             func(...args);
    //         } else {
    //             func();
    //         }
    //     });
    // }

    private static listenForProcessEvents() {
        // the script below is for cleanup on unexpected exit
        // process.stdin.resume(); // so the program will not close instantly

        // do something when app is closing
        // process.on('exit', AppListener.exitHandler.bind(null, {cleanup: true}));

        // catches ctrl+c event
        // process.on('SIGINT', AppListener.exitHandler.bind(null, {cleanup: true}));

        // catches "kill pid" (for example: nodemon restart)
        // process.on('SIGUSR1', AppListener.exitHandler.bind(null, {cleanup: true}));
        // process.on('SIGUSR2', AppListener.exitHandler.bind(null, {cleanup: true}));
    }

    // private static exitHandler(options, exitCode) {
    //     if (options.cleanup) {
    //         AppController.quit();
    //     }
    //     if (options.exit) {
    //         process.exit();
    //     }
    // }
}
