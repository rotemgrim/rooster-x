
export interface IProxySettingsPayload {
    isProxySettingsEnabled: boolean;
    bypassProxy?: boolean;
    bypassAddresses?: string;
    address?: string;
    port?: number;
    username?: string;
    password?: string;
}

export interface IProxySettings {
    address: string;
    port: number;
    username?: string;
    password?: string;
}
