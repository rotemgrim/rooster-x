import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index} from "typeorm";
import {MetaData} from "./MetaData";

@Entity("TorrentFile")
export class TorrentFile extends MetaData {

    // container?: string;
    // website?: string;

    @Column({type: "datetime", nullable: true})
    public downloadedAt: Date;
}
