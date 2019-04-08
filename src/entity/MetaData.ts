import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany} from "typeorm";
import {MediaFile} from "./MediaFile";
import {Episode} from "./Episode";
import {AbsMetaData} from "./AbsMetaData";
import {UserMetaData} from "./UserMetaData";
@Entity("MetaData")
export class MetaData extends AbsMetaData {

    @Column({type: "varchar", length: 40})
    public type: "movie" | "series" | string;

    /** title of the movie */
    @Column({type: "varchar", length: 255, nullable: true})
    public name: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.metaData, {eager: true})
    public mediaFiles: MediaFile[];

    @OneToMany(() => Episode, episode => episode.metaData)
    public episodes: Episode[];

    @Column({type: "varchar", length: 10, default: "not-scanned"})
    public status: "not-scanned" | "failed" | "omdb" | "full";

    @OneToMany(() => UserMetaData, x => x.metaData, {eager: true})
    public userMetaData: UserMetaData[];
}
