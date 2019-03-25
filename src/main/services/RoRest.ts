// import axios from "axios";
import axios from "axios-https-proxy-fix";

import AppGlobal from "../helpers/AppGlobal";
import {IProxySettings} from "../../common/models/IProxySettingsPayload";
import ProxyService from "./ProxyService";
import {ipcMain} from "electron";

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.101 Safari/537.36";

export default class RoRest {

    public static proxy: null | IProxySettings = null;
    private static basicAuthenticationCode: string;

    public static setBasicAuthentication(username: string, password: string) {
        RoRest.basicAuthenticationCode = "basic " + Buffer.from(username + ":" + password).toString("base64");
    }

    public static async send(method: string, url: string, data: any = {}): Promise<any> {
        await ProxyService.updateProxySettings().catch(() => RoRest.proxy = null);
        const user: any = {};
        return new Promise((resolve, reject) => {
            const key = {
                sessionid: user.getSessionKey().sessionId,
                csrftoken: user.getSessionKey().csrfToken,
            };
            const payload = Object.assign({}, data);
            const headers: any = {
                "Cookie": "sessionid=" + key.sessionid + "; csrftoken=" + key.csrftoken + ";",
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "X-CSRFToken": key.csrftoken,
                "User-Agent": userAgent,
                "referer": AppGlobal.getConfig().serverUrl,
            };
            if (RoRest.basicAuthenticationCode) {
                headers.Authorization = RoRest.basicAuthenticationCode;
                delete headers.Cookie;
            }
            const config = {
                url: AppGlobal.getConfig().serverUrl.href + url,
                method,
                headers,
                data: payload,
                timeout: 50000,
            };

            if (RoRest.proxy) {
                Object.assign(config, {
                    proxy: {
                        host: RoRest.proxy.address,
                        port: RoRest.proxy.port,
                        auth: {
                            username: RoRest.proxy.username || "",
                            password: RoRest.proxy.password || "",
                        },
                    },
                });
            }
            axios.request(config).then(res => {
                if (res.data) {
                    console.debug("server resolved | " + method + " -> " + url);
                    resolve(res.data);
                } else {
                    console.info("server did not return any data but its successful");
                    resolve();
                }
            }).catch(e => {
                if (e.response && e.response.data) {
                    if (e.response.status === 403) {
                        console.warn("rest error: " + e.response.status, e.response.data);
                        console.warn("endpoint: " + method + " | " + url);
                        ipcMain.emit("weblogout", {force: true});
                    } else if (e.response.status !== 409) {
                        if (RoRest.proxy !== null) {
                            console.warn("using proxy: " + RoRest.proxy.address + ":" + RoRest.proxy.port);
                        }
                        console.warn("rest error: " + e.response.status, e.response.data);
                        console.warn("endpoint: " + method + " | " + url);
                        console.warn("payload: ", payload);
                    }
                } else {
                    if (RoRest.proxy !== null) {
                        console.warn("failed request, using proxy -> "
                            + RoRest.proxy.address + ":" + RoRest.proxy.port);
                    }
                }
                reject(e);
            });
        });
    }
}
