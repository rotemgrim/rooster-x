import {Menu, Tray, nativeImage} from "electron";
import AppController from "../controllers/AppController";
import WindowManager from "../services/WindowManager";
import MenuItemConstructorOptions = Electron.MenuItemConstructorOptions;
// import MixPanelService from "../services/MixPanelService";
import {icon} from "../../common/static";

let tray: Tray;

export default class TrayBuilder {

    private static openHelp: MenuItemConstructorOptions[] = [
        {label: "Help", click: () => {
            // do stuff
        }},
        {type: "separator"}];

    private static quitOption: MenuItemConstructorOptions[] = [
        {type: "separator"},
        {
            label: "Quit",
            click: () => {
                // MixPanelService.track("Quit", "AppIcon Menu");
                AppController.quit();
            },
        },
    ];

    public static init() {
        console.info("init Tray builder");
        if (tray && !tray.isDestroyed()) {
            tray.destroy();
        }
        let contextMenu;
        // tray = new Tray(path.join(__static, "assets/images/icons/online-icon.ico"));
        // tray = new Tray(path.join(__static, "assets/images/icons/shield_256x256_online.ico"));
        tray = new Tray(nativeImage.createFromDataURL(icon));
        // tray = new Tray("assets/icon.ico");

        tray.setToolTip("RoosterX");
        const template: MenuItemConstructorOptions[] =
            TrayBuilder.openHelp.concat(
                TrayBuilder.quitOption,
            );

        contextMenu = Menu.buildFromTemplate(template);

        tray.on("click", () => {
            WindowManager.getMainWindow().showCenter();
        });
        tray.setContextMenu(contextMenu);
    }
}
