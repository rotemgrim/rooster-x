import "reflect-metadata";
import {Entity, PrimaryGeneratedColumn, Column, OneToMany} from "typeorm";

@Entity("Genre")
export class Genre {

    @PrimaryGeneratedColumn()
    public id: number;

    @Column({type: "varchar", length: 255, unique: true})
    public type: string;

    public constructor(type: string) {
        this.type = type;
    }
}
