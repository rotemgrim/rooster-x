import {createLogger, format, transports} from "winston";
import * as util from "util";
import * as path from "path";
import * as fs from "fs";
import * as mkdirp from "mkdirp";
import AppGlobal from "./AppGlobal";

AppGlobal.init();
const logsFolder = AppGlobal.getLogsDir();

// create logs folder if dose not exist
if (!fs.existsSync(AppGlobal.getUserDataPath()) || !fs.existsSync(logsFolder)) {
    try {
        mkdirp.sync(logsFolder);
    } catch (e) {
        console.error("could not create logs folder: " + logsFolder, e);
        throw new Error("could not create logs folder");
    }
}

const prettyPrint = (data) => {
    if (data && typeof data  === "object" && data.hasOwnProperty("stack") && data.hasOwnProperty("message")) {
        return util.inspect(data);
    }
    try {
        // return JSON.stringify(data, null, 2);
        return util.inspect(data);
    } catch (e) {
        return util.inspect(data);
    }
};

// Define your custom format with printf.
const myFormat = format.printf((info) => {
    const data: any = info.message;
    if (data && data.length > 1 && typeof data[0] === "string") {
        return `${info.timestamp} | ${info.level}: ${data[0]} -> ${prettyPrint(data[1])}`;
    } else if (data && data.length === 1 && typeof data[0] === "string") {
        return `${info.timestamp} | ${info.level}: ${info.message}`;
    } else {
        return `${info.timestamp} | ${info.level}: ${prettyPrint(data)}`;
    }
});
const timeFormat = "YYYY-MM-DD HH:mm:ss";
const logger = createLogger({
    format: format.combine(
        // format.timestamp({format: timeFormat}),
        format.timestamp(),
        format.splat(),
        myFormat,
    ),
    level: process.env.NODE_ENV !== "production" ? "silly" : "info",
    transports: [
        new transports.Console({
            format: format.combine(
                format.timestamp({format: timeFormat}),
                format.colorize(),
                format.splat(),
                myFormat,
            ),
        }),
        // new transports.File({filename: path.join(logsFolder, "error.log"), level: "error"}),
        new transports.File({
            maxsize: (1024 * 1024 * 10),
            maxFiles: 3,
            filename: path.join(logsFolder, "combined.log"),
        }),
    ],
});

// error: 0,
// warn: 1,
// info / log: 2,
// verbose: 3,
// debug: 4,
// silly: 5

console.log = (...args) => logger.info(args);
console.info = (...args) => logger.info(args);
console.warn = (...args) => logger.warn(args);
console.error = (...args) => logger.error(args);
console.debug = (...args) => logger.debug(args);

export function rendererLogger(args) {
    const type = args.shift();
    switch (type) {
        case "log":
            logger.log(args);
            break;
        case "info":
            logger.info(args);
            break;
        case "warn":
            logger.warn(args);
            break;
        case "error":
            logger.error(args);
            break;
        case "debug":
            logger.debug(args);
            break;
        default:
            logger.log(args);
            break;
    }
}
