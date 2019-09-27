import * as path from "path";
import * as fs from "fs";
import * as mkdirp from "mkdirp";
import {IConfig} from "../../common/models/IConfig";
import {URL} from "url";
import AppGlobal from "../helpers/AppGlobal";
import MixPanelService from "../services/MixPanelService";
import ProxyService from "../services/ProxyService";

const RO_FOLDER = path.join(process.env.APPDATA || "", "Rooster-X");
const RO_CONFIG_FILE = path.join(RO_FOLDER, "config.json");

export default class ConfigController {

    public static loadConfig(): Promise<IConfig> {
        return new Promise(async (resolve) => {
            const config = ConfigController.getOrCreateConfigFile();
            AppGlobal.setConfig(config);
            resolve(config);
        });
    }

    public static getConfigPromise(): Promise<IConfig> {
        return new Promise((resolve) => {
            resolve(AppGlobal.getConfig());
        });
    }

    public static updateConfigAndRestart(config: IConfig): Promise<any> {
        // MixPanelService.track("Save Settings", "Settings Window");
        return ConfigController.updateConfig(config);
        // ConfigController.updateConfig(config)
        //     .then(() => {
        //         AppController.logout();
        //
        //         // this will quit the app
        //         // WindowManager.closeAll();
        //         AppController.quit();
        //         // WindowManager.init(config);
        //         // AppController.bootstrapApp();
        //     }).catch((e) => {
        //        console.error("could not update config", e);
        //     });
    }

    public static updateConfig(config: IConfig): Promise<IConfig> {
        return new Promise((resolve, reject) => {
            try {
                const oldConfig = AppGlobal.getConfig();
                config = Object.assign(oldConfig, config);
                if (config.proxySettings && config.proxySettings.isProxySettingsEnabled) {
                    ProxyService.prepareProxySettings(config).then(newConfig => {
                        resolve(ConfigController.saveConfigToFile(newConfig));
                    }).catch((e) => {
                        reject(e);
                    });
                } else {
                    resolve(ConfigController.saveConfigToFile(config));
                }
            } catch (e) {
                console.error("could not save config to file", e);
                reject(e);
            }
        });
    }

    private static saveConfigToFile(config: IConfig): IConfig {
        try {
            console.log("saving config", config);
            fs.writeFileSync(RO_CONFIG_FILE, JSON.stringify(config), { flag: "w", encoding: "utf8" });
            return config;
        } catch (e) {
            console.error(`could not write new ${RO_CONFIG_FILE} file`, e);
            throw new Error(`could not write new ${RO_CONFIG_FILE} file`);
        }
    }

    private static getOrCreateConfigFile(): IConfig {
        // check if folder not exist
        if (!fs.existsSync(RO_FOLDER)) {
            try {
                mkdirp.sync(RO_FOLDER);
            } catch (err) {
                console.error("could not create directory: " + RO_FOLDER, err);
                throw new Error("could not create directory: " + RO_FOLDER);
            }
        }

        // check if file exist
        if (fs.existsSync(RO_CONFIG_FILE)) {
            try {
                const data = fs.readFileSync(RO_CONFIG_FILE);
                const tmpData = JSON.parse(data.toString());
                console.info("serverUrl: " + tmpData.serverUrl);
                const res: IConfig = {
                    serverUrl: new URL(tmpData.serverUrl),
                    keepWindowsAlive: tmpData.keepWindowsAlive !== undefined ? tmpData.keepWindowsAlive : true,
                    dbPath: tmpData.dbPath !== undefined ? tmpData.dbPath : "",
                    omdbApiKey: tmpData.omdbApiKey !== undefined ? tmpData.omdbApiKey : "",
                    userId: tmpData.userId !== undefined ? tmpData.userId : 0,
                    isAdmin: tmpData.isAdmin !== undefined ? tmpData.isAdmin : false,
                };
                if (tmpData.proxySettings !== undefined) {
                    res.proxySettings = tmpData.proxySettings;
                }
                return res;
            } catch (err) {
                console.error(`could not read ${RO_CONFIG_FILE} file`, err);
                throw new Error(`could not read ${RO_CONFIG_FILE} file`);
            }
        } else {
            // create the config file
            const config: IConfig = {
                serverUrl: new URL("http://127.0.0.1"),
                keepWindowsAlive: true,
                dbPath: "",
                omdbApiKey: "",
                userId: 0,
                isAdmin: false,
            };
            return ConfigController.saveConfigToFile(config);
        }
    }
}
