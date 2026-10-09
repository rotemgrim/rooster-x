
import {type MetaData} from "../../entity/MetaData";
import {type Episode} from "../../entity/Episode";
import {type IFeedItem} from "./IFeedItem";

/**
 * A library card's item: the grid row, plus the detail fields the details
 * panel merges into it once the card is opened.
 */
export interface IMetaDataExtended extends IFeedItem, Partial<Omit<MetaData, keyof IFeedItem>> {
}

export interface IEpisodeExtended extends Episode {
    isWatched?: boolean;
}
