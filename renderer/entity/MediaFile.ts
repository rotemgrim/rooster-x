import {type MetaData} from "./MetaData";
import {type Episode} from "./Episode";

export interface MediaFile {

    id: number;

    raw: string;

    path: string;

    hash: string;

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

    // container?: string;
    // website?: string;

    downloadedAt: Date;
}
