import {type User} from "./User";
import {type Episode} from "./Episode";

export interface UserEpisode {

    userId: number;

    episodeId: number;

    isWatched: boolean;

    user: User;

    episode: Episode;
}
