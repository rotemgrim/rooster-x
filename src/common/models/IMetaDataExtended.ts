
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";

export interface IMetaDataExtended extends MetaData {
    stringScore?: number;
    isWatched?: boolean;
    latestChange?: number;
}

export interface IEpisodeExtended extends Episode {
    isWatched?: boolean;
    latestChange?: number;
}
