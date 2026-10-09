
/**
 * Human readable elapsed or remaining time (example: 3 minutes ago)
 * @param  {Date|Number|String} date A Date object, timestamp or string parsable with Date.parse()
 * @param  {Date|Number|String} [nowDate] A Date object, timestamp or string parsable with Date.parse()
 * @param  {Intl.RelativeTimeFormat} [trf] A Intl formater
 * @return {string} Human readable elapsed or remaining time
 * @author github.com/victornpb
 * @see https://stackoverflow.com/a/67338038/938822
 */
export function fromNow(
    date: Date | number | string,
    nowDate: Date | number | string = Date.now(),
    rft = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }),
): string {
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;
    const YEAR = 365 * DAY;
    const MONTH = YEAR / 12;
    const intervals: {ge: number, divisor: number, unit: Intl.RelativeTimeFormatUnit}[] = [
        { ge: YEAR, divisor: YEAR, unit: 'year' },
        { ge: MONTH, divisor: MONTH, unit: 'month' },
        { ge: WEEK, divisor: WEEK, unit: 'week' },
        { ge: DAY, divisor: DAY, unit: 'day' },
        { ge: HOUR, divisor: HOUR, unit: 'hour' },
        { ge: MINUTE, divisor: MINUTE, unit: 'minute' },
        { ge: 30 * SECOND, divisor: SECOND, unit: 'seconds' },
    ];
    const now = typeof nowDate === 'object' ? nowDate.getTime() : new Date(nowDate).getTime();
    const diff = now - (typeof date === 'object' ? date : new Date(date)).getTime();
    const diffAbs = Math.abs(diff);
    for (const interval of intervals) {
        if (diffAbs < DAY) {
            return "today";
        } else if (diffAbs < 2 * DAY) {
            return "yesterday";
        } else if (diffAbs < 3 * DAY) {

        }
        if (diffAbs >= interval.ge) {
            const x = Math.floor(Math.abs(diff) / interval.divisor);
            const isFuture = diff < 0;
            return rft.format(isFuture ? x : -x, interval.unit);
        }
    }
    return "just now";
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

// 1536 -> "1.5 KiB" (binary units, like torrent clients).
export function formatBytes(bytes: number): string {
    let i = 0;
    while (bytes >= 1024 && i < BYTE_UNITS.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${i === 0 ? bytes : bytes.toFixed(1)} ${BYTE_UNITS[i]}`;
}

export const formatSpeed = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`;

// 3900 -> "1h 5m"; negative (unknown) -> "∞".
export function formatDuration(seconds: number): string {
    if (seconds < 0) {
        return "∞";
    }
    if (seconds < 60) {
        return "< 1m";
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// Playback position: 75 -> "1:15", 3900 -> "1:05:00"; 0 or less -> "0:00".
export function formatClock(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Unix seconds -> local date and 24h time; 0 (unknown) -> "".
export function formatUnixDate(unix: number): string {
    if (!unix) {
        return "";
    }
    return new Date(unix * 1000).toLocaleString(undefined, {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
}
