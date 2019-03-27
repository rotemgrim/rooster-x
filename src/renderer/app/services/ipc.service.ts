import {RendererPromiseIpc} from "../../../common/lib/ipcPromise/RendererPromiseIpc";
import {ipcRenderer} from "electron";
import {IConfig} from "../../../common/models/IConfig";
import {URL} from "url";

const promiseIpc = new RendererPromiseIpc({ maxTimeoutMs: 120000 });

export class IpcService {

    constructor() { }

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
                    const config: IConfig = {
                        serverUrl: new URL(tmpConfig.serverUrl),
                        keepWindowsAlive: tmpConfig.keepWindowsAlive !== undefined ? tmpConfig.keepWindowsAlive : true,
                    };
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

    public static installExcelAddin(payload) {
        ipcRenderer.send("install-excel-addin", payload);
    }

    public static restartExplorer(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("restart-explorer").then(resolve).catch(reject);
        });
    }

    public static getIsExtendedLogsActive(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("is-extended-logs-active").then(resolve).catch(reject);
        });
    }

    public static getIsShowAllMenuActive(): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("is-show-all-menu-active").then(resolve).catch(reject);
        });
    }

    public static setIsExtendedLogsActive(flag): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("set-extended-logs-active", flag).then(resolve).catch(reject);
        });
    }

    public static setIsShowAllMenuActive(flag): Promise<any> {
        return new Promise((resolve, reject) => {
            promiseIpc.send("set-show-all-menu-active", flag).then(resolve).catch(reject);
        });
    }
}
