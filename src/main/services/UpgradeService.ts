import * as fs from "fs";
import * as path from "path";
import * as child from "child_process";
import Axios from "axios";
import {app} from "electron";
import {to} from "../../common/commonUtils";
import compareVersions from "compare-versions";
import AppGlobal from "../helpers/AppGlobal";
import Validators from "../../common/Validators";
import WindowManager from "./WindowManager";

const DOWNLOAD_FOLDER = path.join(app.getPath("appData"), "Rooster-X Sync App", "versions");

export default class UpgradeService {

    private static isDownloading = false;
    private static isInstalling = false;

    public static async initUpgradeProcess(upgradeData: any) {
        if (!upgradeData.upgrade_version) {
            // do nothing
            return;
        }

        const currVersion = "0";
        const upgradeVersion = upgradeData.upgrade_version.version ? upgradeData.upgrade_version.version : "";
        const updateType = upgradeData.upgrade_version.update_type ? upgradeData.upgrade_version.update_type : "";
        let err; let pathToFile;

        // checks if we shouldn't start update process
        if (!updateType || UpgradeService.isDownloading || UpgradeService.isInstalling
                || !Validators.isValidVersion(currVersion, upgradeVersion)
                || compareVersions(currVersion, upgradeVersion) >= 0) {
            // do nothing
            return;
        }

        console.info("pending update, version " + currVersion + " to " + upgradeVersion);

        [err, pathToFile] = await to(UpgradeService.downloadNewVersion(upgradeData));
        if (err) { throw new Error(err); }

        if ("ON_IDLE" === updateType) {
            console.info("user can install new version from: " + pathToFile);
        } else if ("IMMEDIATE" === updateType) {
            console.info("start installation from: " + pathToFile);
            UpgradeService.isInstalling = true;
            WindowManager.getMultipurposeWindow().bringForth("updateMessage", {timeToStart: 15000})
                .then(() => {
                    const timeout = setTimeout(() => {
                        clearTimeout(timeout);
                        clearInterval(interval);
                        WindowManager.getMultipurposeWindow().hide();
                        UpgradeService.startInstallation(pathToFile);
                        UpgradeService.snoozed();
                    }, 15000);
                    const interval = setInterval(() => {
                        if (!WindowManager.getMultipurposeWindow().isVisible) {
                            clearTimeout(timeout);
                            clearInterval(interval);
                            console.debug("window hidden! start installation");
                            UpgradeService.startInstallation(pathToFile);
                            UpgradeService.snoozed();
                        }
                    }, 100);
                });
        }
    }

    private static async downloadNewVersion(upgradeData: any): Promise<any> {
        return new Promise((resolve, reject) => {

            // create dir if not exists
            if (!fs.existsSync(DOWNLOAD_FOLDER)) {
                fs.mkdirSync(DOWNLOAD_FOLDER);
            }

            const newVersion = upgradeData.upgrade_version.version;
            const downloadPathFile = path.join(DOWNLOAD_FOLDER, "Rooster-XSyncApp_" + newVersion + ".exe");

            // check if file already downloaded
            if (fs.existsSync(downloadPathFile)) {
                console.debug("skip version download -> already in folder");
                resolve(downloadPathFile);
                return;
            }

            const downloadUrl = upgradeData.upgrade_version.file || upgradeData.upgrade_version.big_file;
            UpgradeService.isDownloading = true;
            UpgradeService.downloadFile(downloadUrl, downloadPathFile)
                .then(pathToFile => {
                    UpgradeService.isDownloading = false;
                    resolve(pathToFile);
                })
                .catch((err) => {
                    UpgradeService.isDownloading = false;
                    console.error("could not download file", err);
                    reject("could not download file");
                });
        });
    }

    private static async downloadFile(url, pathToSave): Promise<any> {

        // axios image download with response type "stream"
        const response = await Axios({
            method: "GET",
            url: AppGlobal.getConfig().serverUrl.href + url,
            responseType: "stream",
        });

        // pipe the result stream into a file on disc
        response.data.pipe(fs.createWriteStream(pathToSave));

        // return a promise and resolve when download finishes
        return new Promise((resolve, reject) => {
            response.data.on("end", () => {
                resolve(pathToSave);
            });

            response.data.on("error", (err) => {
                reject(err);
            });
        });
    }

    private static startInstallation(filePath) {
        child.exec(`"${filePath}" /S`, null, (err, data) => {
            if (err) {
                console.error("installation failed: " + filePath, err);
            }
            if (data) {
                console.log(data.toString());
            }
        });
    }

    private static snoozed() {
        setInterval(() => {
            UpgradeService.isInstalling = false;
        }, 60000 * 5);
    }
}
