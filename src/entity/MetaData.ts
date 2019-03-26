import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany} from "typeorm";
import {MediaFile} from "./MediaFile";
import {Episode} from "./Episode";
@Entity("MetaData")
export class MetaData {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column({type: "varchar", length: 40})
    public type: "movie" | "series";

    @Column({type: "varchar", length: 255})
    public title: string;

    @Column({type: "text", nullable: true})
    public description?: string;

    @Column({type: "text", nullable: true})
    public image?: string;

    @Column({type: "text", nullable: true})
    public trailer?: string;

    @Column({type: "float", nullable: true})
    public IMDBScore?: number;

    @Column({type: "text", nullable: true})
    public IMDBLink?: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.metaData)
    public mediaFiles: MediaFile[];

    @OneToMany(() => Episode, episode => episode.metaData)
    public episodes: Episode[];

}
