import {app, BrowserWindowConstructorOptions} from "electron";
import AbstractWindowController from "./AbstractWindowController";
import AppGlobal from "../helpers/AppGlobal";
import * as path from "path";
declare const __static: any;
const isDevelopment = process.env.NODE_ENV !== "production";

export default class MultipurposeWindowController extends AbstractWindowController {

    public windowName: string = "Multipurpose";

    protected options: BrowserWindowConstructorOptions = {
        title: "Rooster-X",
        alwaysOnTop: false,
        frame: true,
        height: 150,
        icon: path.join(__static, "assets/images/icons/icon.ico"),
        maximizable: true,
        show: false,
        skipTaskbar: false,
        transparent: false,
        width: 510,
        minWidth: 385,
        webPreferences: {
            // nodeIntegration: false,
            // preload: Path.join(__static, "preload", "preload.js"),
        },
    };
    protected isCreated: boolean = false;

    constructor() {
        super();
    }

    // create main BrowserWindow when electron is ready
    public createWindow(options?: BrowserWindowConstructorOptions) {
        options = Object.assign({}, this.options, options);
        super.absCreateWindow(undefined, options);
        console.info(`Creating ${this.windowName} Window...`);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(`${this.windowName} window could not be created`);
                clearTimeout(timeout);
                clearInterval(interval);
                reject();
            }, 60000);
            const interval = setInterval(() => {
                if (this.isCreated) {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    }

    public init() {
        super.init();
        this.isCreated = true;
        console.info(`${this.windowName} window finished loading in ` +
            `${AppGlobal.getTimeSinceInit() / 1000} seconds -> ${this.win.webContents.getURL()}` );
    }

    public hide() {
        this.sendJavascript(`document.body.style = "display: none";`).then(() => {
            this.hideNow();
            this.isVisible = false;
        });
    }

    public hidePromise() {
        return new Promise((resolve) => {
            this.sendJavascript(`document.body.style = "display: none";`).then(() => {
                this.hideNow();
                this.isVisible = false;
                resolve();
            });
        });
    }

    public show() {
        this.sendJavascript(`document.body.style = "display: block";`).then(() => {
            this.win.show();
            this.win.setAlwaysOnTop(true);
            this.win.focus();
            this.win.setAlwaysOnTop(false);
            this.isVisible = true;
        });
    }

    public showPromise(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.sendJavascript(`document.body.style = "display: block";`)
                .then(() => {
                    this.win.show();
                    this.win.setAlwaysOnTop(true);
                    this.win.focus();
                    this.win.setAlwaysOnTop(false);
                    this.isVisible = true;
                }).then(resolve)
                .catch(reject);
        });
    }

    public onClose(e) {
        if (isDevelopment || this.forceClose) {
        // if (this.forceClose) {
             this.isCreated = false;
             this.isExist = false;
        } else {
            if (!app[isQuiting]) {
                e.preventDefault();
                this.hide();
            }
        }
    }

    public onWebFinishedLoad() {
        this.init();
    }

    public bringForth(url?: string, data?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.isExist) {
                // if window exist then show it
                // this.setOriginalWindowSize();
                this.jumpToCenter();
                this.navigate(url, data);
                this.show();
                resolve();
            } else {
                // if not exits create it.
                this.createWindow()
                    .then(() => {
                        this.jumpToCenter();
                        this.navigate(url, data);
                        this.show();
                        resolve();
                    })
                    .catch(reject);
            }
        });
    }
}

const isQuiting = "isQuiting";
