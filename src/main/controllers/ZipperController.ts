import * as AdmZip from "adm-zip";
import * as zipDir from "zip-dir";
import * as mkdirp from "mkdirp";
import AppGlobal from "../helpers/AppGlobal";
import {BrowserWindow, shell} from "electron";
import * as path from "path";
import * as moment from "moment";
import MixPanelService from "../services/MixPanelService";
import WindowManager from "../services/WindowManager";
import {spawn} from "child_process";
import AppController from "./AppController";
import * as fs from "fs";

export default class ZipperController {

    public static async generateLogs() {
        MixPanelService.track("Generate logs", "Settings Window");
        console.info("start generating logs");
        WindowManager.getMultipurposeWindow().send("generate-logs-percent", {percent: 62});

        await ZipperController.extractDxDiag()
            .catch((e) => console.warn("could not extract DxDiag", e));

        WindowManager.getMultipurposeWindow().send("generate-logs-percent", {percent: 86});

        await ZipperController.extractEventViewer()
            .catch((e) => console.warn("could not extract from EventLog", e));

        WindowManager.getMultipurposeWindow().send("generate-logs-percent", {percent: 93});

        console.info("done generating logs");
        ZipperController.zipLogsFolder()
            .then((filePath) => {
                WindowManager.getMultipurposeWindow().send("generate-logs-percent", {percent: 100});
                console.info("done zipping logs");
                setTimeout(() => {
                    shell.showItemInFolder(filePath);
                    WindowManager.hideAll();
                }, 1500);
            })
            .catch(console.error);
    }

    public static clearCache() {
        const win = BrowserWindow.getAllWindows()[0];
        const ses = win.webContents.session;

        ses.getCacheSize((size) => {
            console.info("cache size", size);
        });
        // ses.clearHostResolverCache();
        ses.clearCache(() => {
            ses.getCacheSize((size) => {
                console.info("clear cache complete, new size", size);
            });
        });

        AppController.quit(true);

        // **** below is not really working! maybe in future electron version.
        // ses.clearStorageData({storages: ["appcache", "cookies", "filesystem", "indexdb",
        //         "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
        //     quotas: ["temporary", "persistent", "syncable"]}, () => {
        //     ses.flushStorageData();
        //     ses.getCacheSize((size) => {
        //         console.info("clear storage data complete, new size", size);
        //     });
        // });
    }

    public static extractDxDiag(): Promise<any> {
        const timeout = 30000;
        return new Promise((resolve, reject) => {
            const pathToDxDiagLog = path.join(AppGlobal.getLogsDir(), "DxDiag.log");
            const strArr: ReadonlyArray<string> = ["/dontskip", "/whql:off", "/t", pathToDxDiagLog];
            const dxdiag = spawn("dxdiag.exe", strArr, {detached: true});
            const timeoutTimer = setTimeout(() => {
                process.kill(dxdiag.pid);
                reject("extraction taken too long (" + timeout / 1000 + "s)");
            }, timeout);
            dxdiag.stderr.on("data", (data) => {
                clearTimeout(timeoutTimer);
                reject(data.toString());
            });
            dxdiag.on("close", () => {
                clearTimeout(timeoutTimer);
                resolve();
            });
        });
    }

    public static extractEventViewer(): Promise<any> {
        const timeout = 30000;
        return new Promise((resolve, reject) => {
            const pathToEventLog = path.join(AppGlobal.getLogsDir(), "eventlog.evtx");
            const fromDate = moment().subtract(7, "days").format("YYYY-MM-DD") + "T00:00:00";
            const toDate = moment().add(2, "days").format("YYYY-MM-DD") + "T00:00:00";
            const strArr: ReadonlyArray<string> = [
                "export-log", "Application",
                "/q:*[System[TimeCreated[@SystemTime>='" + fromDate + "'" +
                "and @SystemTime<='" + toDate + "']] and System[(Level=1 or Level=2 or Level=3)]]",
                "/ow:true",  pathToEventLog];
            const wevtutil = spawn("wevtutil", strArr, {detached: true});
            const timeoutTimer = setTimeout(() => {
                process.kill(wevtutil.pid);
                reject("extraction taken too long (" + timeout / 1000 + "s)");
            }, timeout);
            wevtutil.stderr.on("data", (data) => {
                clearTimeout(timeoutTimer);
                reject(data.toString());
            });
            wevtutil.on("close", () => {
                clearTimeout(timeoutTimer);
                resolve();
            });
        });
    }

    public static ArchiveLogsFolder(): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const zip = new AdmZip();
                const fileName: string = "logs-" + moment().format("YYYY-MM-DD HH-mm-ss") + ".zip";
                const filePath: string = path.join(AppGlobal.getUserDataPath(), "archivedLogs", fileName);
                zip.addLocalFolder(AppGlobal.getLogsDir());
                zip.writeZip(filePath);
                resolve(filePath);
            } catch (e) {
                reject(e);
            }
        });
    }

    public static zipLogsFolder(): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const fileName: string = "logs-" + moment().format("YYYY-MM-DD HH-mm-ss") + ".zip";
                const dirPath: string = path.join(AppGlobal.getUserDataPath(), "archivedLogs");
                const filePath: string = path.join(dirPath, fileName);

                // create folder if not exists
                if (!fs.existsSync(dirPath)) {
                    try {
                        mkdirp.sync(dirPath);
                    } catch (e) {
                        console.error("could not create logs folder: " + dirPath, e);
                        reject("could not create logs folder: " + dirPath);
                    }
                }

                zipDir(AppGlobal.getLogsDir(), { saveTo: filePath }, (err, buffer) => {
                    if (err) {
                        reject("could not zip logs to: " + filePath);
                    } else {
                        resolve(filePath);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }
}
