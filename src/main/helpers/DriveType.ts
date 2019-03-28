// import {spawn} from "child_process";
// import {Stats} from "fs";
// import * as fs from "fs";
//
// interface IDriveType {
//     /*
//     0	Unknown
//     1	No root directory
//     2	Removable disk
//     3	Local disk
//     4	Network drive
//     5	Compact disk
//     6	RAM disk
//     */
//     drive: string; // c:, d:, m:
//     type: string | "Unknown" |
//         "No root directory" |
//         "Removable disk" |
//         "Local disk" |
//         "Network drive" |
//         "Network Connection" |
//         "Compact disk" |
//         "RAM disk";
// }
//
// export default class DriveType {
//     private static driveList: IDriveType[] = [];
//
//     private static isDriveListContains(drive: string): undefined | IDriveType {
//         if (DriveType.driveList.length > 0) {
//             return DriveType.driveList.find((d) => {
//                 return d.drive === drive;
//             });
//         }
//         return undefined;
//     }
//
//     private static isNetworkDrive(driveType: IDriveType): boolean {
//         return driveType.type === "Network drive" || driveType.type === "Network Connection";
//     }
//
//     public static async isDriveNetwork(fullPath: string): Promise<any> {
//         return new Promise((resolve, reject) => {
//             const first2Letters = fullPath.substring(0, 2).toLowerCase();
//             if (first2Letters === `\\` || first2Letters === "\\\\") {
//                 resolve(true);
//                 return;
//             }
//
//             const driveType = DriveType.isDriveListContains(first2Letters);
//             if (driveType) {
//                 if (DriveType.isNetworkDrive(driveType)) {
//                     resolve(true);
//                 } else {
//                     reject();
//                 }
//                 return;
//             }
//             // wmic logicaldisk get description,name /format:csv
//             const wmic = spawn("wmic", ["logicaldisk", "get", "description,name", "/format:csv"]);
//             let buffer = "";
//             wmic.stdout.on("data", (data) => {
//                 buffer += data.toString();
//             });
//             wmic.stderr.on("data", (data) => {
//                 console.error("stderr", data.toString());
//                 reject();
//             });
//             wmic.on("close", () => {
//                 // console.log("buffer", buffer);
//                 const result: IDriveType[] = [];
//                 const lines = buffer.split(/\r\r\n/).filter((s) => s).map((l) => {
//                     return l.split(",");
//                 });
//                 // console.log("lines", lines);
//                 let j = 0;
//                 for (const row of lines) {
//                     let type = "";
//                     let drive = "";
//                     let z = 0;
//                     for (const item of row) {
//                         if (j > 0 && lines[0][z] === "Description") {
//                             type = item;
//                         } else if (j > 0 && lines[0][z] === "Name") {
//                             drive = item;
//                         }
//                         z++;
//                     }
//                     if (type && drive) {
//                         const tmpType: IDriveType = {
//                             type,
//                             drive: drive.toLowerCase(),
//                         };
//                         result.push(tmpType);
//                     }
//                     j++;
//                 }
//                 console.info("lines", result);
//
//                 DriveType.driveList = result;
//                 const tmpDriveType = DriveType.isDriveListContains(first2Letters);
//                 if (tmpDriveType) {
//                     if (DriveType.isNetworkDrive(tmpDriveType)) {
//                         resolve(true);
//                     } else {
//                         reject();
//                     }
//                 } else {
//                     console.warn("could not find drive in drive list, assuming network drive");
//                     // if we didnt find out just say it is network
//                     resolve();
//                 }
//             });
//         });
//     }
//
//     public static async resolveFullPath(fullPath: string): Promise<any> {
//         return new Promise((resolve, reject) => {
//             // if starts with // then its valid resolved path by us
//             const first2Letters = fullPath.substring(0, 2).toLowerCase();
//             if (first2Letters === `\\` || first2Letters === "\\\\") {
//                 resolve(fullPath);
//                 return;
//             }
//
//             const remainingPath = fullPath.slice(fullPath.indexOf(":") + 1);
//             const driveLetter = fullPath.slice(fullPath.indexOf(":") - 1, 2);
//             const wmic = spawn("net", ["use", driveLetter]);
//             let buffer = "";
//             wmic.stdout.on("data", (data) => {
//                 buffer += data.toString();
//             });
//             wmic.stderr.on("data", (data) => {
//                 console.warn("stderr when resolving full path: " + fullPath, data.toString());
//                 // resolve(fullPath);
//                 reject();
//             });
//             wmic.on("close", () => {
//                 if (buffer) {
//                     // console.log("buffer for: " + fullPath, buffer);
//                     const lines = buffer.split("\r\n");
//                     const line = lines.filter((o) => {
//                         return o.includes("\\\\");
//                     });
//                     // console.log(line);
//                     const remoteName = line[0].slice(line[0].indexOf("\\\\"));
//                     resolve(remoteName + remainingPath);
//                 } else {
//                     // resolve(fullPath);
//                     reject();
//                 }
//             });
//         });
//     }
//
//     public static getNodeDeviceId(fullPath: string): Promise<{inode: string, devId: string}> {
//         return new Promise((resolve, reject) => {
//             // console.log(fs.stat.toString());
//             fs.stat(fullPath, (statErr, stats: Stats) => {
//                 if (statErr) {
//                     console.error("cant get folder stats", statErr);
//                     reject();
//                 } else {
//                     resolve({
//                         inode: stats.ino.toString(),
//                         devId: stats.dev.toString(),
//                     });
//                 }
//             });
//         });
//     }
//
//     // private static removeComputerName(resolvedPath: string): string {
//     //     return resolvedPath.slice(resolvedPath.split("\\", 3).join("\\").length);
//     // }
// }
