import {RendererPromiseIpc} from "../../common/lib/ipcPromise/RendererPromiseIpc";
import {ipcRenderer} from "electron";
import {IConfig} from "../../common/models/IConfig";
import {URL} from "url";

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

    public static dbQuery(entity: string, query: any): Promise<any> {
        const payload = {entity, query};
        return new Promise((resolve, reject) => {
            promiseIpc.send("db-query", payload).then(resolve).catch(reject);
        });
    }
}
