import LogListener from "../../util/LogListener";
import {Application, SpectronClient} from "spectron";
import * as path from "path";
import * as fs from "fs";

export default class AppCommands {

    public static isAppListening: boolean = false;
    public static commandFilePath: string = "";
    public static gotAnswerForConnected: boolean = false;
    public static isUserConnected: boolean = false;
    public static logListener: LogListener;

    public static init(app: Application) {
        AppCommands.logListener = new LogListener(app.client);

        AppCommands.logListener.add("commandWatch listening on: ", (str) => {
            AppCommands.commandFilePath = path.resolve(str.split(": ")[2]);
            AppCommands.isAppListening = true;
            // console.log("app listening on", AppCommands.commandFilePath);
        });

        AppCommands.logListener.add("user is logged in", (str) => {
            AppCommands.gotAnswerForConnected = true;
            AppCommands.isUserConnected = true;
            // console.log("user is logged in");
        });

        AppCommands.logListener.add("connection invalid", (str) => {
            AppCommands.gotAnswerForConnected = true;
            AppCommands.isUserConnected = false;
            // console.log("user is logged out");
        });

        AppCommands.logListener.add("server response for logout -> OK", (str) => {
            AppCommands.gotAnswerForConnected = true;
            AppCommands.isUserConnected = false;
            // console.log("user just logged out");
        });
    }

    public static write(txtCmd, timeout = 14000) {
        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                if (AppCommands.isAppListening) {
                    clearInterval(interval);
                    fs.writeFile(AppCommands.commandFilePath, txtCmd, { flag: "w" }, err => {
                        if (err) {
                            // console.log(err);
                            reject();
                        } else {
                            // console.log("appended", txtCmd);
                            resolve();
                        }
                    });
                }
            }, 100);
            setTimeout(() => {
                clearInterval(interval);
                reject();
            }, timeout);
        });
    }
}
