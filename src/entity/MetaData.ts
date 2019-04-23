import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany, Index} from "typeorm";
import {MediaFile} from "./MediaFile";
import {Episode} from "./Episode";
import {AbsMetaData} from "./AbsMetaData";
import {UserMetaData} from "./UserMetaData";
import {TorrentFile} from "./TorrentFile";
@Entity("MetaData")
export class MetaData extends AbsMetaData {

    @Index()
    @Column({type: "varchar", length: 40})
    public type: "movie" | "series" | "episode";

    /** title of the movie */
    @Column({type: "varchar", length: 255, nullable: true})
    public name: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.metaData, {eager: true})
    public mediaFiles: MediaFile[];

    @OneToMany(() => TorrentFile, torrentFile => torrentFile.metaData, {eager: true})
    public torrentFiles: TorrentFile[];

    @OneToMany(() => Episode, episode => episode.metaData, {lazy: true})
    public episodes: Episode[];

    @Column({type: "varchar", length: 10, default: "not-scanned"})
    public status: "not-scanned" | "failed" | "omdb" | "full" | "skiped-scan";

    @OneToMany(() => UserMetaData, x => x.metaData, {cascade: true, eager: true})
    public userMetaData: UserMetaData[];

    public constructor() {
        super();
        this.status = "not-scanned";
    }
}
