import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index} from "typeorm";
import {MetaData} from "./MetaData";
import {Episode} from "./Episode";

@Entity("MediaFile")
export class MediaFile {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column("text")
    public raw: string;

    @Index({unique: true})
    @Column({type: "text", collation: "NOCASE"})
    public path: string;

    @Column({type: "varchar", length: 40})
    public hash: string;

    @ManyToOne(() => MetaData, metaData => metaData.mediaFiles, {cascade: true, lazy: true})
    public metaData: MetaData;

    @ManyToOne(() => Episode, episode => episode.mediaFiles, {cascade: true, lazy: true})
    public episode: Episode;

    @Column({type: "int", nullable: true})
    public year?: number;

    @Column({type: "varchar", length: 40, nullable: true})
    public resolution?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public quality?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public codec?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public audio?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public group?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public region?: string;

    @Column({type: "varchar", length: 40, nullable: true})
    public language?: string;

    @Column({type: "boolean", default: false})
    public extended: boolean;

    @Column({type: "boolean", default: false})
    public hardcoded: boolean;

    @Column({type: "boolean", default: false})
    public proper: boolean;

    @Column({type: "boolean", default: false})
    public repack: boolean;

    @Column({type: "boolean", default: false})
    public wideScreen: boolean;

    // container?: string;
    // website?: string;

    @Column({type: "datetime"})
    public downloadedAt: Date;
}
