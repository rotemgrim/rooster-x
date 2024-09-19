import {RendererPromiseIpc} from "../common/lib/ipcPromise/RendererPromiseIpc";
import {IConfig} from "../common/models/IConfig";
// import {URL} from "url";
import {type User} from "../entity/User";
import {type MetaData} from "../entity/MetaData";
import {type Episode} from "../entity/Episode";

const promiseIpc = new RendererPromiseIpc({ maxTimeoutMs: 120000 });
const ipcRenderer = promiseIpc.IpcRenderer();

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
        ipcRenderer.send("set-icon", {status});
    }

    public static changeWindowHeight(height: number) {
        ipcRenderer.send("change-win-height", {height: height + 50});
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
                }).catch(e => {
                    console.log("error getting config", e);
                });
        });
    }

    public static saveConfig(config: IConfig) {
        return promiseIpc.send("save-config", config);
    }

    public static openExternal(url: string) {
        // url encode the url
        if (url.startsWith("magnet:")) {
            url = encodeURI(url);
        }
        ipcRenderer.send("open-external", {url});
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
            promiseIpc.send("get-user", {id}).then(resolve).catch(reject);
        });
    }

    public static getMedia(payload?: {
        filter: "movies" | "series" | "all",
        isTorrents: boolean
    }): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-media", {...payload}).then(resolve).catch(reject);
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
            console.log("get episode payload", payload)
            promiseIpc.send("get-episodes", payload).then(resolve).catch(reject);
        });
    }

    public static getMediaFilesByMetaDataId(payload: {metaDataId: number}): Promise<any> {
        return new Promise((resolve, reject) => {
            console.log("get mediaFiles payload", payload)
            promiseIpc.send("get-media-files", payload).then(resolve).catch(reject);
        });
    }

    public static getMetaDataByFileId(payload: {id: number}): Promise<MetaData|Episode> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-meta-data-by-file-id", payload).then((data) => {
                if (data && data.tmdbSeriesId) {
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

    public static fullFilesScan() {
        ipcRenderer.send("full-sweep");
    }

    public static syncTorrents() {
        ipcRenderer.send("sync-torrents");
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

    public static async getIMDBRating(id: number, imdbId: string | undefined) {
        return new Promise((resolve, reject) => {
            const payload = {metaDataId: id, imdbId};
            promiseIpc.send("get-imdb-rating", payload).then(resolve).catch(reject);
        });
        // const url = `https://www.imdb.com/title/${imdbID}/`;
        // try {
        //     const response = await fetch(url, { mode: 'no-cors'});
        //     const text = await response.text();
        //
        //     // create dom parser to parse the html
        //     const parser = new DOMParser();
        //     const doc = parser.parseFromString(text, 'text/html');
        //     // @ts-ignore
        //     const ratingStr = doc.querySelector("[aria-label='View User Ratings']").innerText;
        //     const tmp = ratingStr.split("\n/10\\n");
        //     const ratingMatch = tmp[0];
        //     const votesMatch = tmp[1];
        //
        //     console.log("ratingStr", ratingStr);
        //     console.log("ratingMatch", ratingMatch);
        //     console.log("votesMatch", votesMatch);
        //
        // } catch (error) {
        //     console.error('Error fetching IMDb rating:', error);
        // }
    }

    public static async getYouTubeTrailer(metaDataId: number, title: string, year?: number) {
         return new Promise((resolve, reject) => {
            const payload = {metaDataId, title, year};
            promiseIpc.send("get-trailer", payload).then(resolve).catch(reject);
        });
        // const url = `"https://www.youtube.com/results?search_query=${title} ${year} trailer"`;
        // try {
        //     const response = await fetch(url, { mode: 'no-cors'});
        //     const text = await response.text();
        //
        //     // find the first youtube video with regex
        //     const regex = /"videoId":"(.*?)"/g;
        //     const match = regex.exec(text);
        //     if (!match) {
        //         console.error('No Youtube trailer found');
        //         return;
        //     }
        //     const videoId = match[1];
        //     console.log("videoId", videoId);
        // } catch (error) {
        //     console.error('Error fetching Youtube trailer:', error);
        // }
    }
}

