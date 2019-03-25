import * as path from "path";
import * as fs from "fs";
import * as winattr from "winattr";
import * as Worker from "tiny-worker";
import {Stats} from "fs";
declare const __static: any;

export function isValidGuid(guid: string): boolean {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(guid);
}

export function checkIfFilePasswordProtectedWorker(obj: {filePath: string, pass?: string})
    : Promise<"file-readable" | "file-too-big" | "cannot-read-file" | "file-is-password-protected"> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__static, "xlsx", "tryToRead.js"));
        const filePath = obj.filePath;
        const pass = obj.pass;
        console.info("worker checking file: " + filePath + " with pass: --HIDDEN--");
        console.debug("provided password: " + pass);

        const timeout = setTimeout(() => {
            reject("cannot-read-file");
        }, 60000);

        worker.onmessage = async (ans) => {
            clearTimeout(timeout);
            console.debug("returned msg", ans.data);
            worker.terminate();
            if (ans.data === "file-readable") {
                resolve();
            } else {
                reject(ans.data);
            }
        };
        worker.postMessage({filePath, pass});
    });
}

export function getFileSizeInMegabytes(filename): Promise<number> {
    return new Promise((resolve, reject) => {
        fs.stat(filename, (err, stats: Stats) => {
            if (err) {
                console.error("cant get filename stats", err);
                resolve(10);
                return;
            }

            const fileSizeInBytes = stats.size;

            // Convert the file size to megabytes (optional)
            const res = fileSizeInBytes / 1000000.0;
            resolve(res);
        });
    });
}

export async function setFileAttribute(filePath: string, attributes) {
    return new Promise((resolve, reject) => {
        winattr.set(filePath, attributes, (err) => {
            if (err) {
                console.warn("could not change file attribute");
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

export async function isFileExistsAsync(filePath: string) {
    return new Promise((resolve, reject) => {
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                reject();
            } else {
                resolve();
            }
        });
    });
}
