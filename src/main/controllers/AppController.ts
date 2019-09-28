import {app, globalShortcut} from "electron";
import WindowManager from "../services/WindowManager";
import {IConfirmationMsg} from "../../common/models/IConfirmationMsg";
import AppGlobal from "../helpers/AppGlobal";
import DBConnection from "../repositories/DBConnection";
import {User} from "../../entity/User";
import {getConnection} from "typeorm";
import FilesListener from "../listeners/FilesListener";
import {UserRepository} from "../repositories/UserRepository";
import {TorrentsRepository} from "../repositories/TorrentsRepository";
import {copyDbFile, uploadDbFile} from "../helpers/miscFuncs";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";

export default class AppController {

    public static allowQuit: boolean = false;
    public static isSyncing: boolean = false;

    public static preOpenWindows() {
        return new Promise(async (resolve, reject) => {
            if (AppGlobal.getConfig().keepWindowsAlive) {
                const promiseArr = [
                    WindowManager.getMainWindow().createWindow()
                        .then(() => console.info("MainWindow created!"))
                        .catch(e => console.warn("could not create mainWindow on startup", e)),
                    // WindowManager.getMultipurposeWindow().createWindow()
                    //     .then(() => console.info("multipurposeWindow created!"))
                    //     .catch(e => console.warn("could not create multipurpose window on startup", e)),
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

    public static async bootstrapApp() {
        // AppController.loginWindow = WindowManager.getLoginWindow();
        // return AppController.login();
        return new Promise(async (resolve) => {
            const config = AppGlobal.getConfig();
            if (config.dbPath) {
                await DBConnection.connect()
                    .then(async () => {
                        const conn = getConnection("reading");
                        const user = await conn.getRepository(User).findOne(config.userId);

                        // const allMeta = await conn.getRepository(MetaData).find();
                        // for (const m of allMeta) {
                        //     if (m.released) {
                        //         await conn.getRepository(MetaData)
                        //             .update(m.id, { released_unix: (new Date(m.released).getTime() / 1000) });
                        //     }
                        // }

                        // const allEpisodes = await conn.getRepository(Episode).find();
                        // for (const m of allEpisodes) {
                        //     if (m.released) {
                        //         await conn.getRepository(Episode)
                        //             .update(m.id, { released_unix: (new Date(m.released).getTime() / 1000) });
                        //     }
                        // }

                        if (user && user.isAdmin) {
                            await uploadDbFile();
                            FilesListener.startSweepInterval(config.dbPath, 3600);
                            UserRepository.startWatchedBackupInterval(10800);
                            TorrentsRepository.startTorrentsWatch();
                            await FilesListener.startMergeDbInterval(config.dbPath, 60 * 2);
                        } else {
                            // refresh view media every hour
                            WindowManager.getMainWindow().send("refresh-media");
                            setInterval(async () => {
                                WindowManager.getMainWindow().send("refresh-media");
                            }, 3600 * 1000);
                        }
                    }).catch(e => console.error("could not establish DB connection", e));
            }
            resolve();
        });
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
                AppController.quit();
            }, 200);
        }
    }

    public static quit() {
        globalShortcut.unregisterAll();
        app[isQuiting] = true;
        app.quit();
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
