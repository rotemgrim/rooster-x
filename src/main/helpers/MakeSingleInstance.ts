import {app} from "electron";
import AppController from "../controllers/AppController";
import CommandWatch from "../services/CommandWatch";

export default class MakeSingleInstance {
    public static init() {
        return new Promise((resolve) => {
            const gotTheLock = app.requestSingleInstanceLock();
            if (!gotTheLock) {
                // show login page if not logged in
                AppController.allowQuit = true;
                AppController.quit();
                resolve();
            } else {
                resolve();
            }
        });
    }
}
