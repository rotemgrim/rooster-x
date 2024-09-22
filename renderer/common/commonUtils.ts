
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

/**
 * Human readable elapsed or remaining time (example: 3 minutes ago)
 * @param  {Date|Number|String} date A Date object, timestamp or string parsable with Date.parse()
 * @param  {Date|Number|String} [nowDate] A Date object, timestamp or string parsable with Date.parse()
 * @param  {Intl.RelativeTimeFormat} [trf] A Intl formater
 * @return {string} Human readable elapsed or remaining time
 * @author github.com/victornpb
 * @see https://stackoverflow.com/a/67338038/938822
 */
// @ts-ignore
export function fromNow(date, nowDate = Date.now(), rft = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })) {
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    const YEAR = 365 * DAY;
    const MONTH = YEAR / 12;
    const intervals = [
        { ge: YEAR, divisor: YEAR, unit: 'year' },
        { ge: MONTH, divisor: MONTH, unit: 'month' },
        { ge: WEEK, divisor: WEEK, unit: 'week' },
        { ge: DAY, divisor: DAY, unit: 'day' },
        { ge: HOUR, divisor: HOUR, unit: 'hour' },
        { ge: MINUTE, divisor: MINUTE, unit: 'minute' },
        { ge: 30 * SECOND, divisor: SECOND, unit: 'seconds' },
        { ge: 0, divisor: 1, text: 'just now' },
    ];
    const now = typeof nowDate === 'object' ? nowDate.getTime() : new Date(nowDate).getTime();
    const diff = now - (typeof date === 'object' ? date : new Date(date)).getTime();
    const diffAbs = Math.abs(diff);
    for (const interval of intervals) {
        if (diffAbs >= interval.ge) {
            const x = Math.round(Math.abs(diff) / interval.divisor);
            const isFuture = diff < 0;
            return interval.unit ? rft.format(isFuture ? x : -x, interval.unit) : interval.text;
        }
    }
}