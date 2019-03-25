import {app, globalShortcut} from "electron";
import WindowManager from "../services/WindowManager";
import {IConfirmationMsg} from "../../common/models/IConfirmationMsg";
import AppGlobal from "../helpers/AppGlobal";

export default class AppController {

    public static allowQuit: boolean = false;
    public static isSyncing: boolean = false;

    public static preOpenWindows() {
        return new Promise(async (resolve, reject) => {
            if (AppGlobal.getConfig().keepWindowsAlive) {
                const promiseArr = [
                    WindowManager.getMultipurposeWindow().createWindow()
                        .then(() => console.info("multipurposeWindow created!"))
                        .catch(e => console.warn("could not create multipurpose window on startup", e)),
                ];

                Promise.all(promiseArr).then(resolve).catch((e) => {
                    console.error("not all windows opened correctly", e);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    public static bootstrapApp() {
        // AppController.loginWindow = WindowManager.getLoginWindow();
        // return AppController.login();
    }

    public static login(): Promise<any> {
        return new Promise((resolve) => resolve());
        // return AuthService.startConnection()
        //     .then(() => {
        //         // connected
        //     })
        //     .catch(() => {
        //         // bring forth login window
        //     });
    }

    public static logout(force: boolean = false) {
        // empty
    }

    public static loggedIn() {
        // empty
    }

    public static showLoginScreen() {
        // const win = WindowManager.getLoginWindow();
        // if (!win.isExist) {
        //     win.createWindow();
        //     win.jumpToCenter();
        //     win.show();
        // } else {
        //     win.navigate("");
        //     win.jumpToCenter();
        //     win.show();
        //     // win.reload();
        // }
    }

    public static async openSettingsWindow() {
        await WindowManager.getMultipurposeWindow().bringForth("settingsWindow");
    }

    public static windowAllClosed(e) {
        // do nothing
        e.preventDefault();

        // quit application when all windows are closed
        // on macOS it is common for applications to stay open until the user explicitly quits
        // if (process.platform !== "darwin") {
        // AppController.quit();
        // }
    }

    public static async willQuit(e) {
        if (!AppController.allowQuit) {
            console.log("Quitting App...");

            // prevent app from quiting
            e.preventDefault();

            // do something before quit
            AppController.allowQuit = true;

            setTimeout(() => {
                console.log("Quitting App -> Bye Bye");
                // and call quit again
                AppController.quit(true);
            }, 200);
        }
    }

    public static quit(force: boolean = false) {
        if ( !force && AppController.isSyncing) {
            AppController.confirmMsg({
                title: `Wait, we are still syncing files to Rooster-X servers.<br/>Are you sure you wanna quit?`,

                // this will shot back as an ipc message
                onConfirmation: "quit-force",
                onCancel: "hide-me",
            });
        } else {
            globalShortcut.unregisterAll();
            app[isQuiting] = true;
            app.quit();
        }
    }

    private static confirmMsg(confirmObj: IConfirmationMsg) {
        WindowManager.getMultipurposeWindow().bringForth("confirmationMsg", confirmObj);
    }

    public static setStartOnStartup() {
        // const appFolder = path.dirname(process.execPath);
        // const updateExe = Path.resolve(appFolder, "..", "Update.exe");
        // const exeName = Path.basename(process.execPath);

        // app.setLoginItemSettings({
        //     openAsHidden: true,
        //     openAtLogin: true,
        //     // path: updateExe,
        //     // args: [
        //     //     "--processStart", `"${exeName}"`,
        //     //     "--process-start-args", `"--hidden"`,
        //     // ]
        // });
    }

    public static setDoNotStartOnStartup() {
        app.setLoginItemSettings({
            openAsHidden: false,
            openAtLogin: false,
        });
    }

    public static isStatupAtLoginOn(): boolean {
        const settingsObj = app.getLoginItemSettings();
        return settingsObj.openAtLogin;
    }
}

const isQuiting = "isQuiting";
