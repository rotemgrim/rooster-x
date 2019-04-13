import "reflect-metadata";
import {Entity, Column, OneToMany, ManyToOne} from "typeorm";
import {MediaFile} from "./MediaFile";
import {MetaData} from "./MetaData";
import {AbsMetaData} from "./AbsMetaData";
import {UserEpisode} from "./UserEpisode";

@Entity("Episode")
export class Episode extends AbsMetaData {

    @Column({type: "int", nullable: true})
    public season?: number;

    @Column({type: "int"})
    public episode: number;

    @Column({type: "varchar", length: 255, nullable: true})
    public imdbSeriesId?: string;

    @OneToMany(() => MediaFile, mediaFile => mediaFile.episode, {eager: true})
    public mediaFiles: MediaFile[];

    @ManyToOne(() => MetaData, metaData => metaData.episodes, {cascade: true, lazy: true})
    public metaData: MetaData;

    @OneToMany(() => UserEpisode, x => x.episode, {eager: true})
    public userEpisode: UserEpisode[];

    // Title : "Pilot"
    // Year : "2014"
    // Rated : "TV-PG"
    // Released : "07 Oct 2014"
    // Season : "1"
    // Episode : "1"
    // Runtime : "44 min"
    // Genre : "Action, Adventure, Drama, Sci-Fi"
    // Director : "David Nutter"
    // Writer : "Greg Berlanti (developed by), Andrew Kreisberg (developed by), Geoff Johns (developed by),
    // Andrew Kreisberg (teleplay by), Geoff Johns (teleplay by), Greg Berlanti (story by), Andrew Kreisberg (story by),
    // Geoff Johns (story by)"
    // Actors : "Grant Gustin, Candice Patton, Danielle Panabaker, Rick Cosnett"
    // Plot : "CSI investigator Barry Allen awakens from a coma, nine months after he was hit by lightning,
    // and discovers he has superhuman speed."
    // Language : "English"
    // Country : "USA"
    // Awards : "N/A"
    // Poster : "https://m.media-amazon.com/images/M/MV5BMjEwMTkyOTQ3NF5BMl5BanBnXkFtZTgwNDQ2NzM4MjE@._V1_SX300.jpg"
    // Ratings
    // Metascore : "N/A"
    // imdbRating : "8.6"
    // imdbVotes : "7417"
    // imdbID : "tt3187092"
    // seriesID : "tt3107288"
    // Type : "episode"
    // Response : "True"
}
