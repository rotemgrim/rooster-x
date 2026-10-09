/**
 * What "get-meta-data-by-file-id" returns (server/message_controller.go
 * GetMetaDataByFileId). For an episode's file, id is the episode id, title
 * and plot are the series', and the episode's own are in episodeTitle /
 * episodePlot.
 */
export interface IFileMetaData {
    id: number;
    title?: string;
    imdbId?: string;
    tmdbId?: number;
    season?: number;
    episode?: number;
    isWatched?: boolean;
    poster?: string;
    plot?: string;
    episodeTitle?: string;
    episodePlot?: string;
}
