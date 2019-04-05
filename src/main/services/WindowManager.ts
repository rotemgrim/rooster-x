
import AbstractWindowController from "../controllers/AbstractWindowController";
import MultipurposeWindowController from "../controllers/MultipurposeWindowController";
import {BrowserWindow} from "electron";
import MainWindowController from "../controllers/MainWindowController";

export default class WindowManager {

    private static allWindows: AbstractWindowController[];
    private static multipurposeWindow: MultipurposeWindowController;
    private static mainWindow: MainWindowController;

    public static init() {
        WindowManager.multipurposeWindow = new MultipurposeWindowController();
        WindowManager.mainWindow = new MainWindowController();
        WindowManager.allWindows = [
            WindowManager.multipurposeWindow,
            WindowManager.mainWindow,
        ];
    }

    public static getMultipurposeWindow() {
        return WindowManager.multipurposeWindow;
    }

    public static getMainWindow() {
        return WindowManager.mainWindow;
    }

    public static hideAll() {
        for (const winController of WindowManager.allWindows) {
            if (winController.isExist && winController.isVisible) {
                winController.hide();
            }
        }
    }

    public static closeAll() {
        for (const winController of WindowManager.allWindows) {
            if (winController.isExist) {
                winController.close();
            }
        }
    }

    public static hideSender(event) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const windowController = WindowManager.getWindowControllerById(win.id);
        if (windowController) {
            windowController.hide();
        }
    }

    public static maximizeSender(event) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const windowController = WindowManager.getWindowControllerById(win.id);
        if (windowController) {
            windowController.maximize();
        }
    }

    public static fullScreenSender(event) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const windowController = WindowManager.getWindowControllerById(win.id);
        if (windowController) {
            windowController.fullScreen();
        }
    }

    public static originalSizeSender(event) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const windowController = WindowManager.getWindowControllerById(win.id);
        if (windowController) {
            windowController.setOriginalWindowSize();
        }
    }

    public static changeSenderHeight(event, height) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const windowController = WindowManager.getWindowControllerById(win.id);
        if (windowController) {
            windowController.setHeight(height);
        }
    }

    public static openDevTools() {
        // MixPanelService.track("OpenDevTools", "Settings Window");
        for (const winCon of WindowManager.allWindows) {
            if (winCon.isExist) {
                winCon.openDevTool();
            }
        }
    }

    private static getWindowControllerById(id: number): AbstractWindowController|null {
        for (const winCon of WindowManager.allWindows) {
            if (winCon.getWinId() === id) {
                return winCon;
            }
        }
        return null;
    }
}
