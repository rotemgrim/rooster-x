
import {Stats} from "fs";
export interface IFSEntry {
    name: string;
    path: string;
    fullPath: string;
    parentDir: string;
    fullParentDir: string;
    stat: Stats;
}
