import {IConfig} from "../../common/models/IConfig";
import {app} from "electron";
import * as path from "path";
const is = require("electron-is");

export default class AppGlobal {

    public static startTime: number;
    public static CONFIG: string = "CONFIG";

    public static getTimeSinceInit() {
        return Date.now() - AppGlobal.startTime;
    }

    public static init() {
        const userDataDir = path.join(app.getPath("appData"), "Rooster-X Sync App");
        const logsDir = path.join(userDataDir, "logs");
        let workingDir;
        if (is.dev()) {
            // workingDir = path.join(app.getPath("programfiles(x86)"), "Rooster-X Sync App");
            workingDir = "C:\\Program Files (x86)\\Rooster-X Sync App";
        } else {
            // todo: get it from registry -> HKEY_LOCAL_MACHINE\SOFTWARE\Rooster-X Sync App
            // workingDir = process.cwd();
            workingDir = path.dirname(process.argv[0]);
        }
        const fileSyncAppPath = path.join(workingDir, "RoFileSyncAppLauncher.exe");
        global["appGlobal.userDataPath"] = userDataDir;
        global["appGlobal.logsDir"] = logsDir;
        global["appGlobal.workingDir"] = workingDir;
        global["appGlobal.fileSyncAppPath"] = fileSyncAppPath;
    }

    public static getConfig(): IConfig {
        return global[AppGlobal.CONFIG];
    }

    public static setConfig(value: IConfig) {
        global[AppGlobal.CONFIG] = value;
    }

    public static set(name: string, obj: any): void {
        global[name] = obj;
    }

    public static get(name: string): any {
        return global[name];
    }

    public static getUserDataPath(): string {
        return global["appGlobal.userDataPath"];
    }

    public static getLogsDir(): string {
        return global["appGlobal.logsDir"];
    }

    public static getWorkingDir(): string {
        return global["appGlobal.workingDir"] || "";
    }

    public static getFileSyncAppPath(): string {
        return global["appGlobal.fileSyncAppPath"];
    }
}
