import {IpcService, promiseIpc} from "./ipc.service";

// Client for the embedded torrent engine: the engine-* messages and the HTTP
// stream it serves files on.

export interface IEngineSettings {
    // a finished torrent stops seeding at either limit, 0 = no limit
    seedDays: number;
    ratioLimit: number;
    seedEndAction: "pause" | "remove"; // remove drops it from the list, keeps the files
    maxDownloadKiB: number; // KiB/s, 0 = unlimited
    maxUploadKiB: number;
    maxActiveDownloads: number; // 0 = unlimited
    maxConnsPerTorrent: number; // 0 = default (50)
    sequentialByDefault: boolean;
    addPaused: boolean;
}

// "stalled": downloading but nothing arriving; "completed": paused after finishing
export type EngineState = "metadata" | "downloading" | "stalled" | "queued" | "seeding" | "paused" | "completed";

export interface IEngineFile {
    index: number;
    path: string;
    length: number;
    completed: number;
    // 100 digits (0-9), how much of each 1% slice is downloaded; only from
    // EngineService.status(hash), for the largest file
    chunks?: string;
}

export interface IEngineStatus {
    infoHash: string;
    name: string;
    hasInfo: boolean;
    length: number;
    completed: number;
    done: boolean;
    peers: number; // connected, seeders included
    seeders: number;
    knownPeers: number;
    sequential: boolean;
    paused: boolean;
    state: EngineState;
    downSpeed: number; // bytes/s
    upSpeed: number;
    eta: number; // seconds, -1 = unknown
    downloaded: number; // payload bytes over all runs
    uploaded: number;
    ratio: number;
    addedAt: number; // unix seconds, 0 = unknown
    completedAt: number;
    availability: number;
    numPieces: number;
    pieceLength: number;
    piecesComplete: number;
    savePath: string;
    files: IEngineFile[] | null;
}

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv)$/i;

export const isVideo = (f: IEngineFile) => VIDEO_EXT.test(f.path);

/** The biggest video in a torrent, usually the movie or episode itself. */
export function largestVideo(files: IEngineFile[] | null | undefined): IEngineFile | undefined {
    return (files ?? []).filter(isVideo).reduce<IEngineFile | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);
}

export class EngineService {
    /** Starts downloading a magnet; resolves to its info hash. */
    public static add(magnet: string): Promise<string> {
        return promiseIpc.send("engine-add", {magnet}) as Promise<string>;
    }

    public static setSequential(infoHash: string, sequential: boolean): Promise<boolean> {
        return promiseIpc.send("engine-set-sequential", {infoHash, sequential}) as Promise<boolean>;
    }

    public static setPaused(infoHash: string, paused: boolean): Promise<boolean> {
        return promiseIpc.send("engine-pause", {infoHash, paused}) as Promise<boolean>;
    }

    public static remove(infoHash: string, deleteFiles: boolean) {
        return promiseIpc.send("engine-remove", {infoHash, deleteFiles});
    }

    /** One torrent, including the chunk map of its largest file. */
    public static status(infoHash: string): Promise<IEngineStatus> {
        return promiseIpc.send("engine-status", {infoHash}) as Promise<IEngineStatus>;
    }

    public static list(): Promise<IEngineStatus[] | null> {
        return promiseIpc.send("engine-status", {}) as Promise<IEngineStatus[] | null>;
    }

    public static getSettings(): Promise<IEngineSettings> {
        return promiseIpc.send("engine-get-settings", {}) as Promise<IEngineSettings>;
    }

    public static saveSettings(settings: IEngineSettings): Promise<IEngineSettings> {
        return promiseIpc.send("engine-save-settings", settings) as Promise<IEngineSettings>;
    }

    /** Streams a torrent's file in mpv, while it downloads. */
    public static play(infoHash: string, file: IEngineFile) {
        const name = encodeURIComponent(file.path.split("/").pop() ?? "");
        // plain http on the same host the UI was opened from; mpv rejects the
        // self-signed cert used on :8443
        IpcService.openInMPV(`http://${location.hostname}:8080/engine/stream/${infoHash}/${file.index}/${name}`);
    }
}
