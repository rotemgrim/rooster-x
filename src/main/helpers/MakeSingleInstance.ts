import {app} from "electron";
import AppController from "../controllers/AppController";
import CommandWatch from "../services/CommandWatch";
import * as fs from "fs";

export default class MakeSingleInstance {
    public static init() {
        return new Promise((resolve) => {
            const gotTheLock = app.requestSingleInstanceLock();
            if (!gotTheLock) {
                // show login page if not logged in
                const txtCmd = "openLoginPage " + CommandWatch.getRoDelimiter() +
                    " noMatterStr " + CommandWatch.getEndOfLine() + "\n\r";
                fs.writeFile(CommandWatch.getCommandFilePath(), txtCmd, { flag: "w" }, err => {
                    if (err) {
                        console.error("could not send open login request", err);
                    } else {
                        console.info("write openLoginPage command to command file");
                    }
                    AppController.allowQuit = true;
                    AppController.quit(true);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}
