import {type UserMetaData} from "./UserMetaData";

export interface User {

    id: number;

    firstName: string;

    lastName: string;

    password: string;

    isAdmin: boolean;

    metaDatas: UserMetaData[];

}
