import {type MetaData} from "./MetaData";
import {type Episode} from "./Episode";

export interface TorrentFile {

    id: number;

    raw: string;

    title: string;

    magnet: string;

    metaData: MetaData;

    episode: Episode;

    year?: number;

    resolution?: string;

    quality?: string;

    codec?: string;

    audio?: string;

    group?: string;

    region?: string;

    language?: string;

    extended: boolean;

    hardcoded: boolean;

    proper: boolean;

    repack: boolean;

    wideScreen: boolean;

    uploadedAt: number;

    // Swarm size from apibay / tracker scrapes; refreshed when older than 2 days.
    seeders?: number | null;
    leechers?: number | null;
    peersUpdatedAt?: number | null; // unix seconds
}
