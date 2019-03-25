
export interface IMediaEntry {
    title: string;
    season?: number;
    episode?: number;
    year?: number;
    resolution?: string;
    quality?: string;
    codec?: string;
    audio?: string;
    group?: string;
    region?: string;
    extended?: boolean;
    hardcoded?: boolean;
    proper?: boolean;
    repack?: boolean;
    container?: string;
    widescreen?: boolean;
    website?: string;
    language?: string;
    garbage?: string;
}
