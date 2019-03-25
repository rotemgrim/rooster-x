import * as fs from "fs";
import * as path from "path";
import {app} from "electron";
import {EventEmitter} from "events";
import * as chokidar from "chokidar";

const commandFilePath = path.join(app.getPath("appData"), "Rooster-X Sync App", "rooster-x-commands.txt");
const endOfLine = "-eol$";
const RoDelimiter = "rooster-delimiter";

export default class CommandWatch extends EventEmitter {

    public static getCommandFilePath(): string {return commandFilePath; }
    public static getEndOfLine(): string {return endOfLine; }
    public static getRoDelimiter(): string {return RoDelimiter; }
    private watcher: any;
    private timerBeforeExtract: any = null;

    constructor() {
        super();

        // first reset the commands file
        fs.writeFile(commandFilePath, "", { flag: "w" }, (err) => {
            if (err) {
                console.error("could not reset command file", err);
                throw new Error("could not reset command file");
            } else {
                this.startCommandWatch();
            }
        });
    }

    private startCommandWatch() {
        this.watcher = chokidar.watch(commandFilePath, {
            persistent: true,
        });

        this.watcher.on("change", () => {
            if (this.timerBeforeExtract) {
                clearTimeout(this.timerBeforeExtract);
            }
            this.timerBeforeExtract = setTimeout(() => {
                this.extractCommand()
                    .then((commandArr) => this.dispatchCommand(commandArr))
                    .catch((e) => console.warn("could not extract command from file", e));
            }, 50);
        });

        setTimeout(() => {
            this.dispatchCommand(["startedWatching", null]);
            console.info("commandWatch listening on: " + commandFilePath);
        });
    }

    private extractCommand(): Promise<any> {
        return new Promise((resolve, reject) => {
            fs.readFile(commandFilePath, "utf8", (err: any, data: any): void => {
                if (err) {
                    reject(err);
                } else {
                    const str = data.toString();

                    // check that there is line ending
                    if (!str.includes(endOfLine)) {
                        reject("no end of line found in command -> invalid command");
                    }

                    // if there will be more then one line it will take the list
                    const listCommands = data.toString().split(endOfLine);

                    // use only the first command in the list
                    const plainTxtCommand = listCommands[0].trim();

                    // all command must have channel and data
                    // split it to channel and data with delimiter " rooster-x-delimiter "
                    if (!plainTxtCommand.includes(RoDelimiter)) {
                        reject("no delimiter found in command -> invalid command: " + plainTxtCommand);
                    }

                    const commandArr = plainTxtCommand.split(` ${RoDelimiter} `);
                    resolve(commandArr);
                }
            });
        });
    }

    private dispatchCommand(commandArr) {
        this.emit(commandArr[0], commandArr[1]);
    }
}
