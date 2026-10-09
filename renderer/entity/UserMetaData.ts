import {type User} from "./User";
import {type MetaData} from "./MetaData";

export interface UserMetaData {

    userId: number;

    metaDataId: number;

    isWatched: boolean;

    user: User;

    metaData: MetaData;
}
