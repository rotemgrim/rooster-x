import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany} from "typeorm";
import {MediaFile} from "./MediaFile";
import {Episode} from "./Episode";
@Entity("MetaData")
export class MetaData {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column({type: "varchar", length: 40})
    public type: "movie" | "series" | string;

    @Column({type: "varchar", length: 255})
    public title: string;

    /** title of the movie */
    @Column({type: "varchar", length: 255, nullable: true})
    public name: string;

    /** id of the movie on imdb */
    @Column({type: "varchar", length: 40, nullable: true})
    public imdbid: string;

    /** direct URL to the movie on imdb */
    @Column({type: "text", nullable: true})
    public imdburl: string;

    /** the genres that this movie belongs to */
    @Column({type: "text", nullable: true})
    public genres: string;

    /** languages this movie was released in */
    @Column({type: "text", nullable: true})
    public languages: string;

    /** countries this movie was released in */
    @Column({type: "text", nullable: true})
    public country: string;

    /** votes received on imdb */
    @Column({type: "text", nullable: true})
    public votes: string;

    /** whether or not this is a TV series */
    @Column({type: "boolean", nullable: true})
    public series: boolean;

    /** the rating as it appears on imdb */
    @Column({type: "float", nullable: true})
    public rating: number;

    /** the runtime of the movie */
    @Column({type: "int", nullable: true})
    public runtime: number;

    /** year the movie was released */
    @Column({type: "int", nullable: true})
    public year: number;

    /** link to the poster for this movie */
    @Column({type: "text", nullable: true})
    public poster: string;

    /** score from a bunch of different review sites */
    @Column({type: "text", nullable: true})
    public metascore: string;

    /** the plot (can either be long or short as specified in {@link MovieRequest}) */
    @Column({type: "text", nullable: true})
    public plot: string;

    /** the directors of the movie */
    @Column({type: "varchar", nullable: true})
    public director: string;

    /** writers of the movie */
    @Column({type: "varchar", nullable: true})
    public writer: string;

    /** leading actors that starred in the movie */
    @Column({type: "text", nullable: true})
    public actors: string;

    /** date that the movie was originally released */
    @Column({type: "varchar", length: 255, nullable: true})
    public released?: string;

    @Column({type: "text", nullable: true})
    public trailer?: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.metaData, {eager: true})
    public mediaFiles: MediaFile[];

    @OneToMany(() => Episode, episode => episode.metaData, {eager: true})
    public episodes: Episode[];

    @Column({type: "varchar", length: 10, default: "not-scanned"})
    public status: "not-scanned" | "failed" | "omdb" | "full";

}
