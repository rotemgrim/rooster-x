import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column} from "typeorm";

@Entity("media")
export class Media {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column({type: "varchar", length: 255, nullable: true})
    public title: string;

    @Column({type: "text", nullable: true})
    public desc: string;

    @Column({type: "varchar", length: 40})
    public type: "movie" | "series";

    @Column({type: "varchar", length: 40})
    public hash: string;

    @Column("text")
    public raw: string;

    @Column("text")
    public path: string;

}
