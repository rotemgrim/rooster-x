import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne} from "typeorm";
import {MediaFile} from "./MediaFile";
import {MetaData} from "./MetaData";

@Entity("Episode")
export class Episode {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column({type: "varchar", length: 255, nullable: true})
    public title?: string;

    @Column({type: "text", nullable: true})
    public description?: string;

    @Column({type: "int", nullable: true})
    public season?: number;

    @Column({type: "int"})
    public episode: number;

    @Column({type: "text", nullable: true})
    public image: string;

    @Column({type: "text", nullable: true})
    public trailer: string;

    @Column({type: "float", nullable: true})
    public IMDBScore: number;

    @Column({type: "float", nullable: true})
    public IMDBLink: number;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.episode)
    public mediaFiles: MediaFile[];

    @ManyToOne(() => MetaData, metaData => metaData.episodes, {cascade: true})
    public metaData: MetaData;

}
