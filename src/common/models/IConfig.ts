import {URL} from "url";
import {IProxySettingsPayload} from "./IProxySettingsPayload";

export interface IConfig {
    serverUrl: URL;
    preLoadHistory?: boolean;
    keepWindowsAlive?: boolean;
    proxySettings?: IProxySettingsPayload;
    autoSyncDownloadFolder?: boolean;
    recordDownload?: boolean;
}
