import {type MediaFile} from "./MediaFile";
import {type Episode} from "./Episode";
import {type AbsMetaData} from "./AbsMetaData";
import {type UserMetaData} from "./UserMetaData";
import {type TorrentFile} from "./TorrentFile";

export interface MetaData extends AbsMetaData {

    type: "movie" | "series" | "episode";

    /** title of the movie */
    name: string;

    mediaFiles: MediaFile[];

    torrentFiles: TorrentFile[];

    episodes: Episode[];

    status: "not-scanned" | "failed" | "omdb" | "full" | "skiped-scan";

    userMetaData: UserMetaData[];
}
