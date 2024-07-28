// catches uncaught exceptions
// process.on("uncaughtException", e => console.warn("uncaughtException was fired", e));
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import "./helpers/Logger";
import "reflect-metadata";
import {app} from "electron";
import {getProxy} from "./helpers/miscFuncs";
import ConfigController from "./controllers/ConfigController";
import AppListener from "./listeners/AppListener";
import MakeSingular from "./helpers/MakeSingleInstance";
import WindowManager from "./services/WindowManager";
import {Container} from "typedi";
import {useContainer} from "typeorm";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("high-dpi-support", "true");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
// app.commandLine.appendSwitch('enable-transparent-visuals');

(async () => {
    try {
        useContainer(Container);
        await MakeSingular.init();
        await ConfigController.loadConfig();
        WindowManager.init();
        await AppListener.init();
    } catch (e) {
        console.error(e);
        throw new Error("Oops! Something went wrong");
    }
})().catch(console.error);

console.info("versions", process.versions);
console.info("Application started... v{%VERSION%} by " + process.env.USERNAME);
console.info("working directory", process.cwd());
console.info("executable", process.argv[0]);
console.info("proxy https/http", getProxy());
