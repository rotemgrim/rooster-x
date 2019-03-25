import {SpectronClient} from "spectron";
import {EventEmitter} from "events";

export default class LogListener extends EventEmitter {

    private getLogs: any;
    private specClient: SpectronClient;
    private subStrArr: string[] = [];
    private callbackArr: any[] = [];

    constructor(specClient: SpectronClient) {
        super();
        this.specClient = specClient;
        this.getLogs = setInterval(() => {
            this.checkLogs();
        }, 500);
    }

    public add(subStr: string, callback) {
        this.subStrArr.push(subStr);
        this.callbackArr.push(callback);
    }

    public clear() {
        clearInterval(this.getLogs);
        this.callbackArr = [];
        this.subStrArr = [];
        this.getLogs = null;
    }

    private checkLogs() {
        if (this.subStrArr.length === 0) {
            return;
        }

        this.specClient.getMainProcessLogs().then(logs => {
            logs.forEach(log => {
                let i = 0;
                for (const subStr of this.subStrArr) {
                    if (log.includes(subStr)) {
                        const logLine = log.slice(0, -1);
                        const callback = this.callbackArr[i];
                        callback(logLine);
                        // this.emit("detect", logLine);
                    }
                    i++;
                }
            });
        });
    }
}