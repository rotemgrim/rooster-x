import {URL} from "url";
import {IProxySettingsPayload} from "./IProxySettingsPayload";

export interface IConfig {
    serverUrl: URL;
    keepWindowsAlive?: boolean;
    proxySettings?: IProxySettingsPayload;
    dbPath?: string;
    tmdbApiKey?: string;
    userId?: number;
    isAdmin?: boolean;
}
