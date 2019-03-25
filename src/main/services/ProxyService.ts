import AppGlobal from "../helpers/AppGlobal";
import RoRest from "./RoRest";
import {IProxySettings, IProxySettingsPayload} from "../../common/models/IProxySettingsPayload";
import {session} from "electron";
import {IConfig} from "../../common/models/IConfig";

export default class ProxyService {

    public static defaultAutoDetectProxyAddress: {address: string, port: number} | null = null;

    /**
     * runs at startup (on app login) and set proxy settings for web windows
     *
     * @param event
     * @param webContents
     * @param request
     * @param authInfo
     * @param callback
     */
    public static initProxySettings(event, webContents, request, authInfo, callback) {
        event.preventDefault();
        const config = AppGlobal.getConfig();
        if (config.proxySettings && config.proxySettings.isProxySettingsEnabled) {
            if (config.proxySettings.bypassProxy) {
                // if we do not prevent default it will clear all stuff
                ProxyService.useBypassProxySettings().catch(console.error);
                if (config.proxySettings.address && config.proxySettings.port) {
                    ProxyService.defaultAutoDetectProxyAddress = {
                        address: config.proxySettings.address,
                        port: config.proxySettings.port,
                    };
                } else {
                    ProxyService.defaultAutoDetectProxyAddress = null;
                }
                callback("", "");
            } else if (config.proxySettings.username) {
                callback(config.proxySettings.username || "", config.proxySettings.password || "");
            }
        }
    }

    /**
     * runs every time we try to send rest request from node.js web windows do not need it
     * they have the auto detect automatically
     *
     * @returns {Promise<IProxySettings | null>}
     */
    public static getAutoDetectedProxy(): Promise<IProxySettings|null> {
        return new Promise((resolve, reject) => {
            try {
                if (ProxyService.defaultAutoDetectProxyAddress) {
                    resolve(ProxyService.defaultAutoDetectProxyAddress);
                } else if (session && session.defaultSession) {
                    session.defaultSession.resolveProxy(AppGlobal.getConfig().serverUrl.href, (proxy) => {
                        let proxyStr = proxy.replace(new RegExp("PROXY ", "g"), "");
                        console.info("use auto-detected proxy", proxyStr);
                        let res: IProxySettings | null = null;
                        if (proxyStr.includes(";")) {
                            proxyStr = proxyStr.split(";")[0];
                        }
                        if (proxyStr.includes(":") && !proxyStr.includes("DIRECT")) {
                            const tmp = proxyStr.split(":");
                            res = {
                                address: tmp[0],
                                port: parseInt(tmp[1], 10),
                            };
                        } else {
                            res = null;
                        }
                        ProxyService.defaultAutoDetectProxyAddress = res;
                        resolve(res);
                    });
                } else {
                    console.warn("could not find session or defaultSession");
                    resolve(null);
                }
            } catch (e) {
                console.warn("could not extract proxy settings from session", e);
                reject("Could not extract proxy url from session, " +
                    "please restart app while proxy settings turned off and then turn bypass on");
            }
        });
    }

    /**
     * use to update on the fly the config settings after change.
     * its not working well when trying to use specific proxy settings because the open windows do not get the update
     *
     * @returns {Promise<any>}
     */
    public static updateProxySettings(): Promise<any> {
        return new Promise((resolve, reject) => {
            const config = AppGlobal.getConfig();
            try {
                if (config.proxySettings && config.proxySettings.isProxySettingsEnabled) {
                    const ps: IProxySettingsPayload = config.proxySettings;
                    if (ps.bypassProxy) {
                        ProxyService.useBypassProxySettings().then(() => resolve());
                    } else if (ps.address && ps.port) {
                        // use the user defined proxy settings
                        RoRest.proxy = {
                            address: ps.address,
                            port: ps.port,
                        };
                        if (ps.username) { RoRest.proxy.username = ps.username; }
                        if (ps.password) { RoRest.proxy.password = ps.password; }
                        console.info("use proxy", config.proxySettings);
                        // todo: find a way to push it to all windows
                        // todo: for now use restart instead (initProxySettings will take new changes into effect)
                        resolve();
                    } else {
                        ProxyService.setAutoDetectedProxy().then(() => resolve());
                    }
                } else {
                    ProxyService.setAutoDetectedProxy().then(() => resolve());
                }
            } catch (e) {
                console.error("could not use proxy settings", e);
                reject();
            }
        });
    }

    /**
     * this function saves the payload into the config file at the main dir
     * and sets the current proxy settings for next request
     *
     * @param config
     */
    public static prepareProxySettings(config: IConfig): Promise<IConfig> {
        return new Promise(async (resolve, reject) => {
            try {
                if (config.proxySettings && config.proxySettings.bypassProxy) {
                    ProxyService.getAutoDetectedProxy()
                        .then(autoDetectedSettings => {
                            if (autoDetectedSettings && config.proxySettings) {
                                config.proxySettings.address = autoDetectedSettings.address;
                                config.proxySettings.port = autoDetectedSettings.port;
                            }
                            resolve(Object.assign(AppGlobal.getConfig(), config));
                        }).catch(reject);
                } else {
                    resolve(config);
                }
            } catch (e) {
                console.error("could not prepare proxy settings for save", e);
                reject();
            }
        });
    }

    /**
     * sets the auto detected settings into config on the fly.
     * used in every request when the proxy settings are off
     * this is to support change in explorer settings on the fly.
     * maybe i should change it in the future.
     *
     * @returns {Promise<any>}
     */
    private static setAutoDetectedProxy(): Promise<any> {
        return new Promise((resolve) => {
            ProxyService.getAutoDetectedProxy().then(result => {
                RoRest.proxy = result;
                const config = AppGlobal.getConfig();
                if (result && config && config.proxySettings) {
                    config.proxySettings.address = result.address || "";
                    config.proxySettings.port = result.port || 80;
                    config.proxySettings.username = result.username ? result.username : "";
                    config.proxySettings.password = result.password ? result.password : "";
                }
                AppGlobal.setConfig(config);
                resolve();
            });
        });
    }

    /**
     * set the bypass settings on the fly so next requests will not go through the proxy.
     * works well in node.js and not always works with open windows, after restart it works
     * need further research on this.
     *
     * @returns {Promise<any>}
     */
    private static useBypassProxySettings() {
        return new Promise((resolve, reject) => {
            const config = AppGlobal.getConfig();

            // if user want to bypass the auto detected proxy settings
            RoRest.proxy = null;

            // todo: find out how to push it to all windows too.
            try {
                if (session && session.defaultSession) {
                    let bypassAddresses = config.serverUrl.hostname;
                    if (config.proxySettings && config.proxySettings.bypassAddresses) {
                        bypassAddresses = config.proxySettings.bypassAddresses;
                        console.info("bypass proxy", config.proxySettings.bypassAddresses);
                    }
                    let proxyRules = "";
                    if (config.proxySettings && config.proxySettings.address && config.proxySettings.port) {
                        proxyRules = config.proxySettings.address + ":" + config.proxySettings.port;
                    }
                    session.defaultSession.setProxy({
                        pacScript: "",
                        proxyRules,
                        proxyBypassRules: bypassAddresses,
                        // config.serverUrl.hostname, // + ";https://static.rooster-x.com",
                    }, resolve);
                } else {
                    reject("session dose not exists");
                }
            } catch (e) {
                reject(e);
            }
        });
    }
}
