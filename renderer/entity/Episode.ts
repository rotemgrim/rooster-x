import {type MediaFile} from "./MediaFile";
import {type MetaData} from "./MetaData";
import {type AbsMetaData} from "./AbsMetaData";
import {type UserEpisode} from "./UserEpisode";
import {type TorrentFile} from "./TorrentFile";

export interface Episode extends AbsMetaData {

    season?: number;

    episode: number;

    imdbSeriesId?: string;

    mediaFiles: MediaFile[];

    torrentFiles: TorrentFile[];

    metaData: MetaData;

    userEpisode: UserEpisode;
}
