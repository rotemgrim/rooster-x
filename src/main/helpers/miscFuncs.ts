import * as fs from "fs";
import * as path from "path";
import AppGlobal from "./AppGlobal";
import {app} from "electron";
import WindowManager from "../services/WindowManager";

export function getChromiumErrorTypeByNetErrorCode(code: number): string {
    let errorType = "Unknown";
    code = Math.abs(code);
    // https://cs.chromium.org/chromium/src/net/base/net_error_list.h
    if (code > 99 && code < 200) {
        errorType = "Connection";
    }
    if (code > 199 && code < 300) {
        errorType = "Certificate";
    }
    if (code > 299 && code < 400) {
        errorType = "HTTP";
    }
    if (code > 399 && code < 500) {
        errorType = "Cache";
    }
    if (code > 499 && code < 600) {
        errorType = "Unknown";
    }
    if (code > 599 && code < 700) {
        errorType = "FTP errors";
    }
    if (code > 699 && code < 800) {
        errorType = "Certificate manager";
    }
    if (code > 799 && code < 900) {
        errorType = "DNS";
    }
    return errorType;
}

export function getServerError(error: any): any {
    if (error && error.response && error.response.data) {
        return error.response.data.detail;
    } else if (error && error.message) {
        return error.message;
    } else if (error && error.errno) {
        return error.errno;
    } else if (error && error.code) {
        return error.code;
    } else {
        return error;
    }
}

export function getProxy(): any {
    const tmp = [process.env.HTTPS_PROXY || process.env.https_proxy,
        process.env.HTTP_PROXY || process.env.http_proxy];
    if (tmp[0] === undefined && tmp[1] === undefined) {
        return "none";
    }
    return tmp;
}

export async function uploadDbFile(): Promise<any> {
    WindowManager.getMainWindow().send("sweep-update", {status: "Uploading Media to DataBase...", count: ""});
    const config = AppGlobal.getConfig();
    if (config.dbPath) {
        let dbPath: string = config.dbPath;
        const dbp = path.join(dbPath, "database.sqlite");
        dbPath = path.join(app.getPath("appData"), "rooster-x", "db.sqlite");
        console.info("upload database to share folder");
        return copyFile(dbPath, dbp)
            .then(() => {
                WindowManager.getMainWindow().send("sweep-update", {status: "", count: ""});
            })
            .catch((e) => {
                console.error(e);
                throw new Error("can't upload DB");
            });
    } else {
        throw new Error("can't upload DB");
    }
}

export async function copyDbFile(): Promise<any> {
    WindowManager.getMainWindow().send("sweep-update", {status: "Downloading Media From DataBase...", count: ""});
    const config = AppGlobal.getConfig();
    if (config.dbPath) {
        let dbPath: string = config.dbPath;
        const dbp = path.join(dbPath, "database.sqlite");
        if (!fs.existsSync(dbp)) {
            console.log("cant copy db file 1 -> file is not existing");
            return;
        }
        dbPath = path.join(app.getPath("appData"), "rooster-x", "db.sqlite");
        console.info("copy database to local");
        return copyFile(dbp, dbPath)
            .then(() => {
                WindowManager.getMainWindow().send("sweep-update", {status: "", count: ""});
            })
            .catch((e) => {
                console.error(e);
                throw new Error("can't copy DB");
            });
    } else {
        // throw new Error("can't copy DB");
        console.log("cant copy db file 2 -> no dbPath");
    }
}

export async function copyFile(from: string, to: string): Promise<any> {
    return new Promise((resolve, reject) => {
        fs.copyFile(from, to, (err) => {
            if (err) {
                console.error(err);
                reject("cant copy file " + from + " to " + to);
            } else {
                resolve();
            }
        });
    });
}
