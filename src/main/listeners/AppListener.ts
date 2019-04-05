import {app, ipcMain, shell} from "electron";
import AppController from "../controllers/AppController";
import AppGlobal from "../helpers/AppGlobal";
import TrayBuilder from "../helpers/TrayBuilder";
import WindowManager from "../services/WindowManager";
import {MainPromiseIpc} from "../../common/lib/ipcPromise/MainPromiseIpc";
import {rendererLogger} from "../helpers/Logger";
import ConfigController from "../controllers/ConfigController";
import ProxyService from "../services/ProxyService";
import __static from "../../common/static";
import {MediaRepository} from "../repositories/MediaRepository";
import {Container} from "typedi";
import FilesController from "../controllers/FilesController";

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
            ipcMain.on("full-screen", (event) => WindowManager.fullScreenSender(event));
            ipcMain.on("quit-app", () => AppController.quit());
            ipcMain.on("maximize-me", (event) => WindowManager.maximizeSender(event));
            ipcMain.on("original-size-me", (event) => WindowManager.originalSizeSender(event));
            ipcMain.on("set-icon", (e, status) => TrayBuilder.setIcon(status));
            ipcMain.on("change-win-height", (e, height) => WindowManager.changeSenderHeight(e, height));
            ipcMain.on("send-to-logger", (e, data) => rendererLogger(data));
            ipcMain.on("open-all-dev-tools", () => WindowManager.openDevTools());
            // ipcMain.on("generate-logs", () => ZipperController.generateLogs());
            // ipcMain.on("clear-cache", () => ZipperController.clearCache());
            ipcMain.on("quit-force", () => AppController.quit());
            ipcMain.on("logout-force", () => AppController.logout(true));

            ipcMain.on("open-external", (e, url) => shell.openExternal(url));

            promiseIpc.on("get-config", ConfigController.getConfigPromise);
            promiseIpc.on("save-config", ConfigController.updateConfigAndRestart);
            promiseIpc.on("get-all-media", () => Container.get(MediaRepository).getAllMedia());
            promiseIpc.on("get-movies", () => Container.get(MediaRepository).getMovies());
            promiseIpc.on("get-series", () => Container.get(MediaRepository).getSeries());
            promiseIpc.on("db-query", (payload) => Container.get(MediaRepository).query(payload));

            AppListener.isListening = true;
            // CommandListener.init();
            // TrayBuilder.init();
            await AppController.preOpenWindows();
            await AppController.bootstrapApp();
            console.log("app is ready!");

            // const test = await Container.get(MediaRepository).query({
            //     entity: "Episode",
            //     query: {
            //         where: {
            //             imdbSeriesId: "tt3107288",
            //         },
            //         order: {
            //             season: "ASC",
            //             episode: "ASC",
            //         },
            //     },
            // });
            // console.log(test[0].mediaFiles);
            // console.log(test[0].raw);

            // await FilesController.doFullSweep("u:\\videos");
            // await FilesController.doFullSweep("Z:\\Complete\\Shirley");

            // const meta = await IMDBController.getMetaDataFromInternet("Aquaman", 2018);
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
}
