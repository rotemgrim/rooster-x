import {Menu, Tray} from "electron";
import AppController from "../controllers/AppController";
import WindowManager from "../services/WindowManager";
import MenuItemConstructorOptions = Electron.MenuItemConstructorOptions;
import MixPanelService from "../services/MixPanelService";
import * as path from "path";
declare const __static: any;

let tray: Tray;

export default class TrayBuilder {

    private static connectedMsg: string = "";
    private static isAlert: boolean = false;

    private static statusOption: MenuItemConstructorOptions[] = [{
        label: "View notifications",
        click: () => {
            MixPanelService.track("Open Status", "AppIcon Menu");
            WindowManager.getMultipurposeWindow()
                .bringForth("statusWindow", {isAlert: TrayBuilder.isAlert});
        }},
        {type: "separator"},
    ];

    private static gettingStartedOption: MenuItemConstructorOptions[] = [{
        label: "Getting started",
        click: async () => {
            MixPanelService.track("Open Getting started", "AppIcon Menu");
            await WindowManager.getMultipurposeWindow().bringForth("loading", {})
                .then(() => WindowManager.getMultipurposeWindow().hidePromise())
                .catch((e) => console.error("could not open getting started screen", e));
        },
    }];

    private static openHelp: MenuItemConstructorOptions[] = [
        {label: "Help", click: () => {
                MixPanelService.track("Open Help", "AppIcon Menu");
            }},
        {type: "separator"}];

    private static settingOption: MenuItemConstructorOptions[] = [{
        label: "Settings",
        click: () => {
            MixPanelService.track("Open Settings", "AppIcon Menu");
            AppController.openSettingsWindow().catch((e) => console.error("could not open settings", e));
        },
    }];

    private static quitOption: MenuItemConstructorOptions[] = [
        {type: "separator"},
        {
            label: "Quit",
            click: () => {
                MixPanelService.track("Quit", "AppIcon Menu");
                AppController.quit();
            },
        },
    ];

    private static loginOption: MenuItemConstructorOptions[] = [{
        label: "Login",
        click: () => {
            MixPanelService.track("Login Clicked", "AppIcon Menu");
            // AppController.login();
            AppController.showLoginScreen();
        },
    }];

    private static logoutOption: MenuItemConstructorOptions[] = [{
        label: "Logout",
        click: () => {
            MixPanelService.track("Logout Clicked", "AppIcon Menu");
            AppController.logout();
        },
    }];

    public static init() {
        console.info("init Tray builder");
        TrayBuilder.setConnected(false);
    }

    public static setConnected(isConnected: boolean = false) {
        if (tray && !tray.isDestroyed()) {
            tray.destroy();
        }
        let contextMenu;
        if (isConnected) {
            // tray = new Tray(path.join(__static, "assets/images/icons/online-icon.ico"));
            tray = new Tray(path.join(__static, "assets/images/icons/shield_256x256_online.ico"));

            // Molad insists on cutting the tooltip to 64 char even when i showed him its working with more :)
            TrayBuilder.connectedMsg = "Connected as ";
            tray.setToolTip(TrayBuilder.connectedMsg);
            const template: MenuItemConstructorOptions[] =
                TrayBuilder.statusOption.concat(
                TrayBuilder.gettingStartedOption,
                TrayBuilder.openHelp,
                TrayBuilder.settingOption,
                TrayBuilder.logoutOption,
                TrayBuilder.quitOption,
            );
            // if (AppGlobal.getConfig().recordDownload) {
            //     template.splice(4, 0, TrayBuilder.recordButton);
            // }
            contextMenu = Menu.buildFromTemplate(template);
        } else {
            // tray = new Tray(path.join(__static, "assets/images/icons/offline-icon.ico"));
            tray = new Tray(path.join(__static, "assets/images/icons/shield_256x256_offline.ico"));
            tray.setToolTip("Right Click to Login");
            contextMenu = Menu.buildFromTemplate(
                TrayBuilder.loginOption.concat(
                TrayBuilder.gettingStartedOption,
                TrayBuilder.openHelp,
                TrayBuilder.settingOption,
                TrayBuilder.quitOption,
            ));
        }
        tray.on("click", () => {
            if (false) {
                if (TrayBuilder.isAlert) {
                    MixPanelService.track("Open Status", "AppIcon Click");
                    WindowManager.getMultipurposeWindow()
                        .bringForth("statusWindow", {
                        }).then(() => WindowManager.getMultipurposeWindow().jumpToCenter());
                } else {
                    tray.popUpContextMenu();
                }
            } else {
                // user is not logged in
                MixPanelService.track("Login Clicked", "AppIcon Click");
                AppController.showLoginScreen();
            }
        });
        tray.setContextMenu(contextMenu);
        console.info("change Tray user context");
    }

    public static setIconSyncing() {
        AppController.isSyncing = true;
        TrayBuilder.isAlert = false;
        console.log("setting tray icon - pending");
        tray.setToolTip("Syncing...");
        tray.setImage(path.join(__static, "assets/images/icons/shield_256x256_sync.ico"));
        // tray.setImage(path.join(__static, "assets/images/icons/sync.ico"));
    }

    public static setIconIdle() {
        AppController.isSyncing = false;
        TrayBuilder.isAlert = false;
        console.log("setting tray icon - idle");
        tray.setToolTip(TrayBuilder.connectedMsg);
        tray.setImage(path.join(__static, "assets/images/icons/shield_256x256_online.ico"));
        // tray.setImage(path.join(__static, "assets/images/icons/online-icon.ico"));
    }

    public static setIconErrors() {
        AppController.isSyncing = false;

        if (!TrayBuilder.isAlert) {
            TrayBuilder.isAlert = true;
            console.log("setting tray icon - alert");
            // tray.setToolTip("Click to see messages...");
            tray.setToolTip(TrayBuilder.connectedMsg);
            tray.setImage(path.join(__static, "assets/images/icons/shield_256x256_allert.ico"));
            // tray.setImage(path.join(__static, "assets/images/icons/alert2.ico"));
        }
    }

    public static setIcon(status: "idle" | "alert" | "syncing") {
        if (status === "idle") {
            TrayBuilder.setIconIdle();
        } else if (status === "alert") {
            TrayBuilder.setIconErrors();
        } else if (status === "syncing") {
            TrayBuilder.setIconSyncing();
        }
    }
}
