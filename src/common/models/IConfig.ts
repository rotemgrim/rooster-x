import {URL} from "url";
import {IProxySettingsPayload} from "./IProxySettingsPayload";

export interface IConfig {
    serverUrl: URL;
    keepWindowsAlive?: boolean;
    proxySettings?: IProxySettingsPayload;
    dbPath?: string;
    omdbApiKey?: string;
    userId?: number;
    isAdmin?: boolean;
}
