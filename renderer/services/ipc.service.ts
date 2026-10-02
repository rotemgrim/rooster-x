import {RendererPromiseIpc} from "../common/lib/ipcPromise/RendererPromiseIpc";
import {IConfig} from "../common/models/IConfig";
// import {URL} from "url";
import {type User} from "../entity/User";
import {type MetaData} from "../entity/MetaData";
import {type Episode} from "../entity/Episode";

const promiseIpc = new RendererPromiseIpc({ maxTimeoutMs: 120000 });
const ipcRenderer = promiseIpc.IpcRenderer();

export class IpcService {

    public static setUserId(userId: number) {
        promiseIpc.setUserId(userId);
    }

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
                    // config.serverUrl = new URL(tmpConfig.serverUrl);
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

    public static openInMPV(url: string, id?: string | number) {
        ipcRenderer.send("open-in-mpv", {url, id});
    }

    // Built-in torrent engine
    public static engineAdd(magnet: string): Promise<string> {
        return promiseIpc.send("engine-add", {magnet}) as Promise<string>;
    }

    public static engineSetSequential(infoHash: string, sequential: boolean): Promise<boolean> {
        return promiseIpc.send("engine-set-sequential", {infoHash, sequential}) as Promise<boolean>;
    }

    public static enginePause(infoHash: string, paused: boolean): Promise<boolean> {
        return promiseIpc.send("engine-pause", {infoHash, paused}) as Promise<boolean>;
    }

    public static engineRemove(infoHash: string, deleteFiles: boolean) {
        return promiseIpc.send("engine-remove", {infoHash, deleteFiles});
    }

    public static engineStatus(infoHash: string): Promise<IEngineStatus> {
        return promiseIpc.send("engine-status", {infoHash}) as Promise<IEngineStatus>;
    }

    public static engineList(): Promise<IEngineStatus[] | null> {
        return promiseIpc.send("engine-status", {}) as Promise<IEngineStatus[] | null>;
    }

    public static engineGetSettings(): Promise<IEngineSettings> {
        return promiseIpc.send("engine-get-settings", {}) as Promise<IEngineSettings>;
    }

    public static engineSaveSettings(settings: IEngineSettings): Promise<IEngineSettings> {
        return promiseIpc.send("engine-save-settings", settings) as Promise<IEngineSettings>;
    }

    public static getWatchProgress(kind: "movie" | "episode", id: number): Promise<null | {
        roosterId: string;
        kind: string;
        refId: number;
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
        updatedAt: number;
    }> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-watch-progress", {kind, id}).then(resolve as any).catch(reject);
        });
    }

    /**
     * Bulk-fetch watch progress for many ids in one round-trip. Returns a
     * map keyed by refId (string), e.g. {"42": {percent, timePos, ...}}.
     * Ids without a saved progress row are simply absent from the map.
     */
    public static getWatchProgressBulk(kind: "movie" | "episode", ids: number[]): Promise<Record<string, {
        roosterId: string;
        kind: string;
        refId: number;
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
        updatedAt: number;
    }>> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-watch-progress-bulk", {kind, ids})
                .then((res: any) => resolve(res || {}))
                .catch(reject);
        });
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

    public static getChannels(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-channels").then(resolve).catch(reject);
        });
    }

    public static fetchChannelIcon(channelName: string, cleanName: string, logoUrl: string): Promise<string> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("fetch-channel-icon", {channelName, cleanName, logoUrl}).then(resolve).catch(reject);
        });
    }

    public static getMedia(payload?: {
        filter: "movies" | "series" | "all",
        isTorrents: boolean,
        genres?: string[]
    }, onBatch?: (batch: any[]) => void): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-media", {...payload}, onBatch).then(resolve).catch(reject);
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

    // ---- Lists ----------------------------------------------------------
    public static getLists(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-lists").then(resolve as any).catch(reject);
        });
    }

    public static createList(name: string): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("create-list", {name}).then(resolve).catch(reject);
        });
    }

    public static updateList(id: number, name: string): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("update-list", {id, name}).then(resolve).catch(reject);
        });
    }

    public static deleteList(id: number): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("delete-list", {id}).then(resolve).catch(reject);
        });
    }

    public static getListItems(listId: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-list-items", {listId}).then(resolve as any).catch(reject);
        });
    }

    public static addListItem(listId: number, metaDataId: number): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("add-list-item", {listId, metaDataId}).then(resolve).catch(reject);
        });
    }

    public static removeListItem(listId: number, metaDataId: number): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("remove-list-item", {listId, metaDataId}).then(resolve).catch(reject);
        });
    }

    public static reorderListItems(listId: number, metaDataIds: number[]): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("reorder-list-items", {listId, metaDataIds}).then(resolve).catch(reject);
        });
    }

    public static getListsContaining(metaDataId: number): Promise<number[]> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("get-lists-containing", {metaDataId}).then(resolve as any).catch(reject);
        });
    }

    public static enrichMetadata(metaDataId: number, force: boolean = true): Promise<MetaData> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("enrich-metadata", {metaDataId, force}).then(resolve as any).catch(reject);
        });
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

export interface IEngineSettings {
    seedDays: number; // stop seeding this many days after completing, 0 = forever
    maxDownloadKiB: number; // KiB/s, 0 = unlimited
    maxUploadKiB: number;
}

export interface IEngineStatus {
    infoHash: string;
    name: string;
    hasInfo: boolean;
    length: number;
    completed: number;
    peers: number; // connected, seeders included
    seeders: number;
    knownPeers: number;
    sequential: boolean;
    paused: boolean;
    state: "metadata" | "downloading" | "stalled" | "seeding" | "paused" | "completed";
    downSpeed: number; // bytes/s
    upSpeed: number;
    downloaded: number; // payload bytes over all runs
    uploaded: number;
    addedAt: number; // unix seconds, 0 = unknown
    completedAt: number;
    availability: number;
    numPieces: number;
    pieceLength: number;
    piecesComplete: number;
    savePath: string;
    // chunks: 100 digits (0-9), how much of each 1% slice of the file is downloaded
    files: {index: number; path: string; length: number; completed: number; chunks?: string}[] | null;
}
