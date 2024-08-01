import "reflect-metadata";
import {Entity, Column, OneToMany, ManyToOne, Index} from "typeorm";
import {MediaFile} from "./MediaFile";
import {MetaData} from "./MetaData";
import {AbsMetaData} from "./AbsMetaData";
import {UserEpisode} from "./UserEpisode";
import {TorrentFile} from "./TorrentFile";

@Entity("Episode")
@Index(["season", "episode", "metaData"], { unique: true })
export class Episode extends AbsMetaData {

    @Column({type: "int", nullable: true})
    public season?: number;

    @Column({type: "int"})
    public episode: number;

    @Index()
    @Column({type: "varchar", length: 255, nullable: true})
    public imdbSeriesId?: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.episode, {eager: true})
    public mediaFiles: MediaFile[];

    @OneToMany(() => TorrentFile, torrentFile => torrentFile.episode, {eager: true})
    public torrentFiles: TorrentFile[];

    @ManyToOne(() => MetaData, metaData => metaData.episodes, {cascade: true, lazy: true})
    public metaData: MetaData;

    @OneToMany(() => UserEpisode, x => x.episode, {eager: true, cascade: true})
    public userEpisode: UserEpisode[];
}
