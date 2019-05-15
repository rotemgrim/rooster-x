import {Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn} from "typeorm";
import {MetaData} from "./MetaData";

@Entity()
export class Alias {

    @PrimaryGeneratedColumn()
    public id: number;

    @Index({unique: true})
    @Column({type: "varchar", length: 255, collation: "NOCASE"})
    public alias: string;

    @Column({type: "varchar", length: 255, collation: "NOCASE"})
    public realTitle: string;

    @ManyToOne(() => MetaData)
    @JoinColumn({name: "metaDataId"})
    public metaData: MetaData;

}
