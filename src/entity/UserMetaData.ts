import {Entity, Column, PrimaryColumn, JoinColumn, ManyToOne} from "typeorm";
import {User} from "./User";
import {MetaData} from "./MetaData";

@Entity("UserMetaData")
export class UserMetaData {

    @PrimaryColumn("int")
    public userId: number;

    @PrimaryColumn("int")
    public metaDataId: number;

    @Column({type: "boolean"})
    public isWatched: boolean;

    @ManyToOne(() => User)
    @JoinColumn({name: "userId"})
    public user: User;

    @ManyToOne(() => MetaData)
    @JoinColumn({name: "metaDataId"})
    public metaData: MetaData;
}
