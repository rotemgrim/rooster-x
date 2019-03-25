
import * as Path from "path";
import * as _ from "lodash";

// return filename without extension.
export function getBaseNameFromPath(filePath: string): string {
    const ext = Path.extname(filePath);
    return Path.basename(filePath, ext);
}

// return filename with extension.
export function getBaseNameFromPathWithExt(filePath: string): string {
    return Path.basename(filePath);
}

// returns the directory Path without the filename
export function getDirectoryPath(filePath: string): string {
    return Path.dirname(filePath);
}

export function to(promise): [null|Error, any] {
    return promise.then(data => {
        return [null, data];
    }).catch(err => {
        if (err) {
            return [err];
        } else {
            return [true];
        }
    });
}

export function waitFor(func, retryTime = 100, timeoutTime = 60000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            clearInterval(interval);
            reject("timed out");
        }, timeoutTime);
        const interval = setInterval(async () => {
            // console.log(func.toString(), await func());
            if (await func() === true) {
                clearTimeout(timeout);
                clearInterval(interval);
                resolve();
            }
        }, retryTime);
    });
}
