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
import {UserRepository} from "../repositories/UserRepository";
import {GenreRepository} from "../repositories/GenreRepository";
import FilesListener from "./FilesListener";
import {TorrentsRepository} from "../repositories/TorrentsRepository";
import {UserMetaData} from "../../entity/UserMetaData";
import IMDBService from "../services/IMDBService";
import IMDBController from "../controllers/IMDBController";

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
        app.on("second-instance", (event, argv, cwd) => WindowManager.getMainWindow().showCenter());
        app.on("ready", async () => {

            // from renderer -> ask to do stuff
            ipcMain.on("hide-me", (event) => WindowManager.hideSender(event));
            ipcMain.on("full-screen", (event) => WindowManager.fullScreenSender(event));
            ipcMain.on("quit-app", () => AppController.quit());
            ipcMain.on("maximize-me", (event) => WindowManager.maximizeSender(event));
            ipcMain.on("original-size-me", (event) => WindowManager.originalSizeSender(event));
            // ipcMain.on("set-icon", (e, status) => TrayBuilder.setIcon(status));
            ipcMain.on("change-win-height", (e, height) => WindowManager.changeSenderHeight(e, height));
            ipcMain.on("send-to-logger", (e, data) => rendererLogger(data));
            ipcMain.on("open-all-dev-tools", () => WindowManager.openDevTools());
            // ipcMain.on("generate-logs", () => ZipperController.generateLogs());
            // ipcMain.on("clear-cache", () => ZipperController.clearCache());
            ipcMain.on("quit-force", () => AppController.quit());
            ipcMain.on("logout-force", () => AppController.logout(true));

            ipcMain.on("open-external", (e, url) => shell.openExternal(url));
            ipcMain.on("scan-dir", (e, payload) => Container.get(FilesController).doFullSweep(payload.dir));
            ipcMain.on("scan-file", (e, payload) => Container.get(FilesController).sweepFile(payload.file));

            promiseIpc.on("get-config", ConfigController.getConfigPromise);
            promiseIpc.on("save-config", ConfigController.updateConfigAndRestart);
            promiseIpc.on("get-all-users", () => Container.get(UserRepository).getAllUsers());
            promiseIpc.on("get-all-torrents", () => Container.get(TorrentsRepository).getAllTorrents());
            promiseIpc.on("get-all-media", () => Container.get(MediaRepository).getAllMedia());
            promiseIpc.on("get-all-genres", () => Container.get(GenreRepository).getAllGenres());
            promiseIpc.on("get-movies", () => Container.get(MediaRepository).getMovies());
            promiseIpc.on("get-series", () => Container.get(MediaRepository).getSeries());
            promiseIpc.on("get-episodes", (payload) => Container.get(MediaRepository).getEpisodes(payload));
            promiseIpc.on("get-meta-data", (payload) => Container.get(MediaRepository).getMetaData(payload));
            promiseIpc.on("get-meta-data-by-file-id", (payload) =>
                Container.get(MediaRepository).getMetaDataByFileId(payload));
            promiseIpc.on("db-query", (payload) => Container.get(MediaRepository).query(payload));
            promiseIpc.on("select-directory-dialog", () => FilesController.selectDbPathFolder());
            promiseIpc.on("create-user", (user) => Container.get(UserRepository).createUser(user));
            promiseIpc.on("get-user", (id) => Container.get(UserRepository).getUser(id));
            promiseIpc.on("set-watched", (payload) => Container.get(MediaRepository).setWatched(payload));
            promiseIpc.on("reprocess-genres", () => Container.get(GenreRepository).reprocessAllGenres());
            promiseIpc.on("reprocess-torrents", () => Container.get(TorrentsRepository).reprocessTorrents());
            promiseIpc.on("re-search-title", (payload) => IMDBController.searchMetaDataFromInternet(payload));
            promiseIpc.on("update-meta-data-by-id", (payload) =>
                Container.get(MediaRepository).updateMetaDataById(payload));

            AppListener.isListening = true;
            await AppController.bootstrapApp();
            // CommandListener.init();
            TrayBuilder.init();
            await AppController.preOpenWindows();
            // FilesListener.init();
            console.log("app is ready!");

            // Container.get(TorrentsRepository).reprocessTorrents()
            //     .then(console.log).catch(console.error);

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

            // const fc = Container.get(FilesController);
            // await fc.doFullSweep("u:\\videos");
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
