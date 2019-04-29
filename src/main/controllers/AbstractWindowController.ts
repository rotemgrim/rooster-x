import __static from "../../common/static";
import * as Electron from "electron";
import * as path from "path";
import { URL, format as formatUrl } from "url";
import {app, BrowserWindow, screen} from "electron";
import BrowserWindowConstructorOptions = Electron.BrowserWindowConstructorOptions;
import AppGlobal from "../helpers/AppGlobal";
const is = require("electron-is");
const isDevelopment = process.env.NODE_ENV !== "production";

abstract class AbstractWindowController {
    public windowName: string = "abstractWindow";
    public isExist: boolean = false;
    public isVisible: boolean = false;
    public isFinishLoad: boolean = false;
    public forceClose: boolean = false;
    protected win = {} as BrowserWindow;
    protected winIsClosing: boolean = false;
    protected abstract options: BrowserWindowConstructorOptions;
    private absOptions: BrowserWindowConstructorOptions = {
        alwaysOnTop: false,
        title: "Rooster-X",
        frame: true,
        icon: path.join(__static, "assets/images/icons/icon.ico"),
        show: false,
        skipTaskbar: false,
        transparent: false,
        minWidth: 385,
        minHeight: 150,
        resizable: true,
    };
    // private position: any;

    constructor() {
        this.isExist = false;
        this.win = {} as BrowserWindow;
    }

    public getWinId(): number {
        return this.win.id;
    }

    public show(): void {
        // this.win.show();
        this.win.focus();
        if (!this.isVisible) {
            if (is.windows()) {
                // this.win.setPosition(this.position[0], this.position[1], false);
                // this.win.setPosition(this.position[0], this.position[1], false);
                // this.send("showCss");
                this.win.show();
            } else if (is.osx()) {
                app.show();
            } else {
                this.win.show();
            }
            this.isVisible = true;
        }
        app.focus();
    }

    public jumpToCenter(): void {
        const WINDOW_WIDTH = this.win.getBounds().width;
        const WINDOW_HEIGHT = this.win.getBounds().height;
        const mousePoint = screen.getCursorScreenPoint();
        const bounds = screen.getDisplayNearestPoint(mousePoint).bounds;

        const x = Math.ceil(bounds.x + ((bounds.width - WINDOW_WIDTH) / 2));
        const y = Math.ceil(bounds.y + ((bounds.height - WINDOW_HEIGHT) / 3));
        this.win.setPosition(x, y);
    }

    public hide(): void {
        if (this.isVisible && this.win) {
            // this.position = this.win.getPosition();
            if (is.windows()) {
                // this.win.setPosition(5000, 5000, false);
                // this.send("hideCss");
                // this.win.minimize();
                // this.win.showInactive();
                this.hideNow();
            } else if (is.osx()) {
                app.hide();
            } else {
                this.hideNow();
            }

            this.send("changePackage", null); // clear any set packages in search
            this.isVisible = false;
        }
    }

    public hideNow() {
        // if (this.isVisible && this.win && typeof this.win.hide === "function") {
        if (this.win && typeof this.win.hide === "function") {
            this.win.hide();
            this.jumpToCenter();
            this.isVisible = false;
        }
    }

    public close(force = false) {
        if (this.win && this.win.close) {
            this.winIsClosing = true;
            if (force) {
                this.forceClose = true;
            }
            this.win.close();
            // this.win = {} as BrowserWindow;
            this.isExist = false;
        }
    }

    public setHeight(height: number) {
        const currentSize = this.win.getSize();
        if (this.absOptions.resizable && this.absOptions.minHeight) {
            if (height !== currentSize[1] && height >= this.absOptions.minHeight) {
                this.win.setSize(currentSize[0], height);
            } else if (height < this.absOptions.minHeight) {
                this.win.setSize(currentSize[0], this.absOptions.minHeight);
            }
        } else {
            console.warn("window could not resize because there it is not resizable or dont have minHeight value");
        }
    }

    public setSize(width: number, height: number) {
        const currentSize = this.win.getSize();
        let changeToHeight = height;
        let changeToWidth = width;
        if (this.absOptions.resizable && this.absOptions.minHeight && this.absOptions.minWidth) {
            if (height >= this.absOptions.minHeight) {
                changeToHeight = height;
            } else {
                changeToHeight = this.absOptions.minHeight;
            }
            if (width >= this.absOptions.minWidth) {
                changeToWidth = width;
            } else {
                changeToWidth = this.absOptions.minWidth;
            }

            if ((changeToHeight !== currentSize[1] || changeToWidth !== currentSize[0])) {
                try {
                    this.win.setSize(changeToWidth, changeToHeight);
                } catch (e) {
                    console.error("window could not resize", e);
                }
            }
        } else {
            console.warn("window could not resize because there it is not " +
                "resizable or dont have minHeight value & minWidth");
        }
    }

    public maximize() {
        if (this.win) {
            this.sendJavascript(`document.body.style = "display: none";`)
                .then(() => {
                    setTimeout(() => {
                        this.win.maximize();
                        return this.sendJavascript(`document.body.style = "display: block";`);
                    }, 500);
                }).catch(e => console.warn("could not maximize window", e));
        }
    }

    public fullScreen() {
        if (this.win) {
            if (this.win.isFullScreen()) {
                this.win.setFullScreen(false);
            } else {
                this.win.setFullScreen(true);
            }
        }
    }

    public setOriginalWindowSize() {
        if (this.win && this.options && this.options.width && this.options.height) {
            this.win.setSize(this.options.width, this.options.height);
            this.jumpToCenter();
        }
    }

    public focus(): void {
        this.win.focus();
    }

    public navigate(url?: string, data?: any) {
        // const user = AuthService.getCurrentUser();
        this.send("navigate", {url, data});
    }

    public openDevTool() {
        this.win.webContents.openDevTools();
    }

    public abstract createWindow(options?: BrowserWindowConstructorOptions);

    protected absCreateWindow(url?: URL, options?: Electron.BrowserWindowConstructorOptions): void {
        AppGlobal.startTime = Date.now();
        this.absOptions = Object.assign(this.absOptions, options);
        this.isFinishLoad = false;
        this.win = new BrowserWindow(this.absOptions);
        this.win.setMenu(null);
        this.registerEvents();

        if (url) {
            this.win.loadURL(url.href);
        } else {
            if (isDevelopment) {
                this.win.loadURL(`http://localhost:${process.env.ELECTRON_WEBPACK_WDS_PORT}`);
            } else {
                this.win.loadURL(formatUrl({
                    pathname: path.join(__dirname, "index.html"),
                    protocol: "file",
                    slashes: true,
                }));
            }
        }

        if (isDevelopment) {
            // this.win.webContents.openDevTools();
        }

        this.isExist = true;
        this.isVisible = false;
        this.forceClose = false;
        this.winIsClosing = false;
    }

    protected registerEvents() {
        this.win.once("ready-to-show", e => this.onReadyToShow(e));
        this.on("resize", e => this.onResize(e));
        this.on("blur",   e => this.onBlur(e));
        this.on("focus",  e => this.onFocus(e));
        this.on("closed", e => this.onClosed(e));
        this.on("close",  e => this.onClose(e));
        this.on("unresponsive",  e => console.warn("window is unresponsive", e));
        this.onWebContent("did-finish-load", () => this.onWebFinishedLoad());
        this.onWebContent("did-fail-load", (...args) => this.onWebFailLoad(...args));
        this.onWebContent("devtools-opened", () => this.onWebDevToolsOpened());
        this.onWebContent("crashed", (e) => console.error("webContent crashed", e));
    }

    protected onReadyToShow(e): void {return; }
    protected onResize(e): void {return; }
    protected onBlur(e): void { return; }
    protected onFocus(e): void {return; }
    protected onClosed(e): void { this.closed(e); }
    protected onClose(e): void { return; }
    protected onWebFinishedLoad(): void {this.init(); }
    protected onWebFailLoad(...args): void { this.failedLoading(...args); }
    protected onWebDevToolsOpened(): void {this.setFocusAfterDevToolOpen(); }

    protected on(event: any, callback: (res) => void): void {
        this.win.on(event, callback);
    }

    protected onWebContent(event: any, callback: (res) => void): void {
        this.win.webContents.on(event, callback);
    }

    public send(channel: string, obj: any): void {
        if (this.isExist) {
            console.info("sending to ", channel);
            this.win.webContents.send(channel, obj);
        }
    }

    protected init(): void {
        // this.position = this.win.getPosition();
        this.isVisible = true;
        this.isFinishLoad = true;
        this.win.setHasShadow(false);
    }

    protected failedLoading(...args) {
        this.isFinishLoad = false;
    }

    protected toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    protected closed(e): void {
        this.win = {} as Electron.BrowserWindow;
        this.isExist = false;
        this.isFinishLoad = false;
    }

    protected setFocusAfterDevToolOpen() {
        this.focus();
        setImmediate(() => this.focus());
    }

    public sendJavascript(
        code: string, userGesture: boolean = true, callback?: (result: any) => void): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.win && this.win.webContents && this.win.webContents.executeJavaScript) {
                try {
                    this.win.webContents.executeJavaScript(code, userGesture, async (res) => {
                        if (callback) {
                            await callback(res);
                        }
                        setTimeout(() => {
                            resolve(res);
                        }, 15);
                    });
                } catch (e) {
                    console.error(`could not send javascript command to window`, e);
                    reject(e);
                }
            } else {
                console.warn(`${this.windowName} was unavailable to receive JS command`, code);
                reject();
            }
        });
    }
}

export default AbstractWindowController;
