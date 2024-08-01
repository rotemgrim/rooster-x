import {RendererPromiseIpc} from "../../common/lib/ipcPromise/RendererPromiseIpc";
import {ipcRenderer} from "electron";
import {IConfig} from "../../common/models/IConfig";
import {URL} from "url";
import {type User} from "../../entity/User";
import {type MetaData} from "../../entity/MetaData";
import {type Episode} from "../../entity/Episode";

const promiseIpc = new RendererPromiseIpc({ maxTimeoutMs: 120000 });

export class IpcService {

    public static simpleSignal(channel: string, data?: any) {
        if (data) {
            ipcRenderer.send(channel, data);
        } else {
            console.log("sending", channel);
            ipcRenderer.send(channel);
        }
    }

    public static hideMe() {
        ipcRenderer.send("hide-me");
    }

    public static fullScreen() {
        ipcRenderer.send("full-screen");
    }

    public static quitApp() {
        ipcRenderer.send("quit-app");
    }

    public static setIcon(status: "idle" | "alert" | "syncing") {
        ipcRenderer.send("set-icon", status);
    }

    public static changeWindowHeight(height: number) {
        ipcRenderer.send("change-win-height", height + 50);
    }

    public static getConfig(): Promise<IConfig> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-config")
                .then(tmpConfig => {
                    const config: IConfig = Object.assign({}, tmpConfig);
                    config.serverUrl = new URL(tmpConfig.serverUrl);
                    config.keepWindowsAlive = tmpConfig.keepWindowsAlive !== undefined ?
                        tmpConfig.keepWindowsAlive : true;
                    if (tmpConfig.proxySettings) {
                        config.proxySettings = tmpConfig.proxySettings;
                    }
                    resolve(config);
                }).catch(reject);
        });
    }

    public static saveConfig(config: IConfig) {
        console.log("sending config", config);
        return promiseIpc.send("save-config", config);
    }

    public static openExternal(url: string) {
        ipcRenderer.send("open-external", url);
    }

    public static openAppData() {
        ipcRenderer.send("open-appdata-folder");
    }

    public static openDevTools() {
        ipcRenderer.send("open-all-dev-tools");
    }

    public static generateLogs() {
        ipcRenderer.send("generate-logs");
    }

    public static startDiagnostic() {
        ipcRenderer.send("start-diagnostic");
    }

    public static clearCache() {
        ipcRenderer.send("clear-cache");
    }

    public static restartExplorer(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("restart-explorer").then(resolve).catch(reject);
        });
    }

    public static getAllUsers(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-all-users").then(resolve).catch(reject);
        });
    }

    public static getUser(id: number): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-user", id).then(resolve).catch(reject);
        });
    }

    public static getAllTorrents(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-all-torrents").then(resolve).catch(reject);
        });
    }

    public static getAllMedia(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-all-media").then(resolve).catch(reject);
        });
    }

    public static getAllMovies(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-movies").then(resolve).catch(reject);
        });
    }

    public static getAllSeries(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-series").then(resolve).catch(reject);
        });
    }

    public static getAllGenres(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-all-genres").then(resolve).catch(reject);
        });
    }

    public static getMetaDataById(payload: {id: number}): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-meta-data", payload).then(resolve).catch(reject);
        });
    }

    public static getEpisodes(payload: {metaDataId: number}): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-episodes", payload).then(resolve).catch(reject);
        });
    }

    public static getMetaDataByFileId(payload: {id: number}): Promise<MetaData|Episode> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-meta-data-by-file-id", payload).then((data) => {
                if (data && data.imdbSeriesId) {
                    if (!data.metaData) {
                        data.metaData = data.__metaData__;
                    }
                }
                resolve(data);
            }).catch(reject);
        });
    }

    public static dbQuery(entity: string, query: any): Promise<any> {
        const payload = {entity, query};
        return new Promise((resolve, reject) => {
            promiseIpc.send("db-query", payload).then(resolve).catch(reject);
        });
    }

    public static scanDir(payload: {dir: string}) {
        ipcRenderer.send("scan-dir", payload);
    }

    public static scanFile(payload: {file: string}) {
        ipcRenderer.send("scan-file", payload);
    }

    public static openSelectFolderDialog() {
        return new Promise((resolve, reject) => {
            promiseIpc.send("select-directory-dialog").then(resolve).catch(reject);
        });
    }

    public static createUser(payload: User): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("create-user", payload).then(resolve).catch(reject);
        });
    }

    public static setWatched(payload: {type: string, entityId: number, isWatched: boolean}): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("set-watched", payload).then(resolve).catch(reject);
        });
    }

    public static reprocessGenres(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("reprocess-genres").then(resolve).catch(reject);
        });
    }

    public static reprocessTorrents(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("reprocess-torrents").then(resolve).catch(reject);
        });
    }

    public static reSearch(title: string, year?: number, type?: "movie" | "series" | "episode"): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload = {title};
            promiseIpc.send("re-search-title", payload).then(resolve).catch(reject);
        });
    }

    public static updateMetaDataById(imdbId: string, id: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload = {imdbId, id};
            promiseIpc.send("update-meta-data-by-id", payload).then(resolve).catch(reject);
        });
    }
}
