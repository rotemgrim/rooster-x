import {app, BrowserWindow, BrowserWindowConstructorOptions, nativeImage} from "electron";
import AbstractWindowController from "./AbstractWindowController";
import * as path from "path";
import * as isDev from "electron-is-dev";
import {icon} from "../../common/static";

export default class MainWindowController extends AbstractWindowController {

    public windowName: string = "Main";

    protected options: BrowserWindowConstructorOptions = {
        title: "Rooster-X",
        alwaysOnTop: false,
        frame: false,
        height: 800,
        icon: nativeImage.createFromDataURL(icon),
        maximizable: true,
        show: true,
        skipTaskbar: false,
        transparent: false,
        width: 1024,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            webSecurity: false,
            nodeIntegration: true,
            experimentalFeatures: true,
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
        this.isFinishLoad = false;
        this.win = new BrowserWindow(options);
        this.win.setMenu(null);
        this.registerEvents();

        if (isDev) {
            this.win.webContents.openDevTools();
            console.log("dir", path.join(__dirname, "../../../build/index.html"));
            this.win.loadFile("build/index.html");
        } else {
            this.win.loadFile("build/index.html");
        }

        console.info(`Creating ${this.windowName} Window...`);
        // this.win.loadFile("../renderer/mainWindow.html");
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
        this.isExist = true;
    }

    public onClose(e) {
        if (isDev || this.forceClose) {
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
}

const isQuiting = "isQuiting";
