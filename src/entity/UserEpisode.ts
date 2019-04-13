import {Entity, Column, PrimaryColumn, JoinColumn, ManyToOne} from "typeorm";
import {User} from "./User";
import {Episode} from "./Episode";

@Entity("UserEpisode")
export class UserEpisode {

    @PrimaryColumn("int")
    public userId: number;

    @PrimaryColumn("int")
    public episodeId: number;

    @Column({type: "boolean"})
    public isWatched: boolean;

    @ManyToOne(() => User)
    @JoinColumn({name: "userId"})
    public user: User;

    @ManyToOne(() => Episode)
    @JoinColumn({name: "episodeId"})
    public episode: Episode;
}
