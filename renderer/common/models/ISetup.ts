// Mirrors config.Config in config/config.go.
export interface ISetupConfig {
    tmdbApiKey: string;
    lang: string;
    directories: string[];
    fullDirectoriesSweep: string[];
    torrentsSweep: string[];
    imdbRatingPoll: string;
    metadataEnrichPoll: string;
    downloadDir: string;
    xtream: {username: string, password: string, server: string};
}

export interface ISetupState {
    needsSetup: boolean;
    config?: ISetupConfig;
}

export interface IDirListing {
    path: string;
    parent: string;
    dirs: string[];
}
