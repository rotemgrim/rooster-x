import {RendererPromiseIpc} from "../common/lib/ipcPromise/RendererPromiseIpc";
import {type User} from "../entity/User";
import {type MetaData} from "../entity/MetaData";
import {type Genre} from "../entity/Genre";
import {type MediaFile} from "../entity/MediaFile";
import {type TorrentFile} from "../entity/TorrentFile";
import {type IEpisodeExtended} from "../common/models/IMetaDataExtended";
import {type IDirListing, type ISetupConfig, type ISetupState, type ISetupUser} from "../common/models/ISetup";
import {type IFileMetaData} from "../common/models/IFileMetaData";
import {type IFeedItem} from "../common/models/IFeedItem";
import {type IListItemRow, type IListRow} from "../common/models/IList";

export const promiseIpc = new RendererPromiseIpc({ maxTimeoutMs: 120000 });

export interface IWatchProgress {
    roosterId: string;
    kind: string;
    refId: number;
    percent: number;
    timePos: number;
    duration: number;
    finished: boolean;
    updatedAt: number;
}

export interface IMediaFiles {
    mediaFiles?: MediaFile[];
    torrentFiles?: TorrentFile[];
}

/**
 * The server's routes (server/message_router.go, setup_controller.go), one
 * typed method each.
 */
export class IpcService {

    public static setUserId(userId: number) {
        promiseIpc.setUserId(userId);
    }

    public static openExternal(url: string): Promise<string> {
        // url encode the url
        if (url.startsWith("magnet:")) {
            url = encodeURI(url);
        }
        return promiseIpc.send("open-external", {url});
    }

    public static openInMPV(url: string, id?: string | number): Promise<string> {
        return promiseIpc.send("open-in-mpv", {url, id});
    }

    public static getWatchProgress(kind: "movie" | "episode", id: number): Promise<IWatchProgress | null> {
        return promiseIpc.send("get-watch-progress", {kind, id});
    }

    /**
     * Bulk-fetch watch progress for many ids in one round-trip. Returns a
     * map keyed by refId (string), e.g. {"42": {percent, timePos, ...}}.
     * Ids without a saved progress row are simply absent from the map.
     */
    public static getWatchProgressBulk(kind: "movie" | "episode", ids: number[]): Promise<Record<string, IWatchProgress>> {
        return promiseIpc.send<Record<string, IWatchProgress> | null>("get-watch-progress-bulk", {kind, ids})
            .then(res => res || {});
    }

    public static getAllUsers(): Promise<User[]> {
        return promiseIpc.send("get-all-users");
    }

    /** The channel list as a JSON string. */
    public static getChannels(): Promise<string> {
        return promiseIpc.send("get-channels");
    }

    public static fetchChannelIcon(channelName: string, cleanName: string, logoUrl: string): Promise<string> {
        return promiseIpc.send("fetch-channel-icon", {channelName, cleanName, logoUrl});
    }

    /** Streams the library feed for one view; each batch of rows goes to onBatch. */
    public static getMedia(payload: {isTorrents: boolean, genres: string[]}, onBatch: (batch: IFeedItem[]) => void): Promise<unknown> {
        return promiseIpc.send("get-media", payload, onBatch);
    }

    public static getAllGenres(): Promise<Genre[]> {
        return promiseIpc.send("get-all-genres");
    }

    public static getMetaDataById(payload: {id: number}): Promise<MetaData | null> {
        return promiseIpc.send("get-meta-data", payload);
    }

    /**
     * When some torrents' peer counts are stale, onStored first gets the
     * episodes with the stored counts; the promise resolves once the trackers
     * have answered.
     */
    public static getEpisodes(payload: {metaDataId: number},
                              onStored: (episodes: IEpisodeExtended[]) => void): Promise<IEpisodeExtended[]> {
        return promiseIpc.send("get-episodes", payload, onStored);
    }

    /** onStored as in getEpisodes. */
    public static getMediaFilesByMetaDataId(payload: {metaDataId: number},
                                            onStored: (files: IMediaFiles) => void): Promise<IMediaFiles> {
        return promiseIpc.send("get-media-files", payload, onStored);
    }

    public static getMetaDataByFileId(payload: {id: number}): Promise<IFileMetaData> {
        return promiseIpc.send("get-meta-data-by-file-id", payload);
    }

    /** Starts a full sweep of the media folders; progress arrives as server messages. */
    public static fullFilesScan(): Promise<string> {
        return promiseIpc.send("full-sweep");
    }

    /** Starts a torrent sync; progress arrives as server messages. */
    public static syncTorrents(): Promise<string> {
        return promiseIpc.send("sync-torrents");
    }

    public static getSetup(): Promise<ISetupState> {
        return promiseIpc.send("get-setup");
    }

    public static setupCheckTmdbKey(key: string): Promise<string> {
        return promiseIpc.send("setup-check-tmdb-key", {key});
    }

    public static setupListDirs(path: string): Promise<IDirListing> {
        return promiseIpc.send("setup-list-dirs", {path});
    }

    public static setupCreateUser(user: Omit<ISetupUser, "id">): Promise<ISetupUser[]> {
        return promiseIpc.send("setup-create-user", user);
    }

    public static setupDeleteUser(id: number): Promise<ISetupUser[]> {
        return promiseIpc.send("setup-delete-user", {id});
    }

    public static setupComplete(config: ISetupConfig): Promise<string> {
        return promiseIpc.send("setup-complete", config);
    }

    public static setWatched(payload: {type: "MetaData" | "Episode", entityId: number, isWatched: boolean}): Promise<{isSeriesWatched: boolean}> {
        return promiseIpc.send("set-watched", payload);
    }

    public static reprocessGenres(): Promise<string> {
        return promiseIpc.send("reprocess-genres");
    }

    public static getIMDBRating(id: number, imdbId: string | undefined): Promise<{Score: number, Votes: number} | null> {
        return promiseIpc.send("get-imdb-rating", {metaDataId: id, imdbId});
    }

    // ---- Lists ----------------------------------------------------------
    public static getLists(): Promise<IListRow[] | null> {
        return promiseIpc.send("get-lists");
    }

    public static createList(name: string): Promise<IListRow> {
        return promiseIpc.send("create-list", {name});
    }

    public static updateList(id: number, name: string): Promise<unknown> {
        return promiseIpc.send("update-list", {id, name});
    }

    public static deleteList(id: number): Promise<unknown> {
        return promiseIpc.send("delete-list", {id});
    }

    public static getListItems(listId: number): Promise<IListItemRow[] | null> {
        return promiseIpc.send("get-list-items", {listId});
    }

    public static addListItem(listId: number, metaDataId: number): Promise<unknown> {
        return promiseIpc.send("add-list-item", {listId, metaDataId});
    }

    public static removeListItem(listId: number, metaDataId: number): Promise<unknown> {
        return promiseIpc.send("remove-list-item", {listId, metaDataId});
    }

    public static reorderListItems(listId: number, metaDataIds: number[]): Promise<unknown> {
        return promiseIpc.send("reorder-list-items", {listId, metaDataIds});
    }

    public static getListsContaining(metaDataId: number): Promise<number[] | null> {
        return promiseIpc.send("get-lists-containing", {metaDataId});
    }

    public static enrichMetadata(metaDataId: number, force: boolean = true): Promise<MetaData | null> {
        return promiseIpc.send("enrich-metadata", {metaDataId, force});
    }

    /**
     * Re-fetches from TMDB a series' episodes that have no still or plot:
     * how many were missing either, and how many have both now.
     */
    public static refreshEpisodes(metaDataId: number): Promise<{missing: number, filled: number}> {
        return promiseIpc.send("refresh-episodes", {metaDataId});
    }

    /** The trailer's URL, or empty when none was found. */
    public static getYouTubeTrailer(metaDataId: number, title: string, year?: number): Promise<string> {
        return promiseIpc.send("get-trailer", {metaDataId, title, year});
    }
}
