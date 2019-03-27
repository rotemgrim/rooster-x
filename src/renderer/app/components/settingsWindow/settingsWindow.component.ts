import {Component, NgZone, OnDestroy, OnInit} from "@angular/core";
import {ActivatedRoute} from "@angular/router";
import {StorageService} from "../../services/storage.service";
import {IpcService} from "../../services/ipc.service";
import {IConfig} from "../../../../common/models/IConfig";
import {URL} from "url";
import User from "../../../../common/models/User";
import {IProxySettingsPayload} from "../../../../common/models/IProxySettingsPayload";
import {ipcRenderer} from "electron";

@Component({
    templateUrl: "settingsWindow.component.html",
    selector: "settings-window",
    styles: [
        "hr { margin: 15px 0 15px 0;} button.off {opacity: .65;}"
    ],
})
export class SettingsWindowComponent implements OnInit, OnDestroy {

    isLoading = true;
    isLoadingDeterminate = false;
    generateLogsPercent = 0;
    percentUpdateTimer: any = null;

    componentHeight = 0;
    version = "{%VERSION%}";
    serverUrl = "";
    preLoadHistory = true;
    keepWindowsAlive = true;
    config = {} as IConfig;
    user = {} as User;
    configErrMsg = "";
    addinInstallPath = "";

    isDiagnosticRunning = false;
    showDevSettings = true;
    showAdvanced = false;
    isProxySettingsEnabled = false;
    bypassProxy = false;

    bypassAddresses = "https://app.rooster-x.com;https://static.rooster-x.com";
    proxyAddress = "";
    proxyPort = 80;
    proxyUser = "";
    proxyPass = "";

    buttonsErrorText = "";
    restartingExplorer = false;
    isAllMenuItemsActive = false;
    isExtendedLogsActive = false;
    testClass = {
        1: ["forward", "slide-in-blurred-left checking"],
        2: ["", ""],
        3: ["", ""],
        4: ["", ""],
        5: ["", ""],
        6: ["", ""],
        7: ["", ""],
    };

    constructor(
        private route: ActivatedRoute,
        private storage: StorageService,
        private ngZone: NgZone,
    ) {

        if (!ipcRenderer.eventNames().includes("generate-logs-percent")) {
            ipcRenderer.on("generate-logs-percent", (event, data) => {
                this.ngZone.run(() => {
                    this.countPercent(data.percent);
                });
            });

            setInterval(() => {
                this.adjustHeight();
            }, 100);
        }

        if (!ipcRenderer.eventNames().includes("test-check-number")) {
            ipcRenderer.on("test-check-number", (event, data) => {
                this.ngZone.run(() => {
                    this.testClass[data.num + 1] = ["forward", "slide-in-blurred-left checking"];
                    if (data.pass) {
                        this.testClass[data.num] = ["check_circle", "flip-in-ver-right pass"];
                    } else {
                        this.testClass[data.num] = ["sentiment_very_dissatisfied", "flip-in-ver-right failed"];
                    }
                });
            });
        }
    }

    private countPercent(percent) {
        if (this.percentUpdateTimer) {
            clearInterval(this.percentUpdateTimer);
            this.percentUpdateTimer = null;
        }
        this.percentUpdateTimer = setInterval(() => {
            this.generateLogsPercent++;
            this.isLoadingDeterminate = this.generateLogsPercent > 0 && this.generateLogsPercent < 100;
            if (this.generateLogsPercent >= percent) {
                clearInterval(this.percentUpdateTimer);
            }
        }, 20);
    }

    ngOnInit() {
        this.route.queryParams.subscribe(() => {
            console.log("settingsWindowComponent init", this.storage.data);
            // this.user = new User();
            // this.user.setFieldsFromData(this.storage.data.currentUser);
            this.getAndPopulateConfig();
            this.addinInstallPath = this.storage.data.addinInstallPath;
        });
    }

    ngOnDestroy() {
        ipcRenderer.removeAllListeners("generate-logs-percent");
        ipcRenderer.removeAllListeners("test-check-number");
    }

    private getAndPopulateConfig() {
        IpcService.getConfig().then(config => {
            this.config = config;
            console.log("config", this.config);
            if (this.config.serverUrl && this.config.serverUrl.href) {
                this.serverUrl = this.config.serverUrl.href;
            }
            this.keepWindowsAlive = this.config.keepWindowsAlive !== undefined ? this.config.keepWindowsAlive : true;
            console.log("config in renderer: ", this.serverUrl);

            if (config.proxySettings) {
                this.isProxySettingsEnabled = config.proxySettings.isProxySettingsEnabled || false;
                if (config.proxySettings.bypassProxy) {
                    this.bypassProxy = config.proxySettings.bypassProxy;
                    this.bypassAddresses = config.proxySettings.bypassAddresses || this.bypassAddresses;
                } else {
                    this.bypassProxy = false;
                }

                this.proxyAddress = config.proxySettings.address || "";
                this.proxyPort = config.proxySettings.port || 80;
                this.proxyUser = config.proxySettings.username || "";
                this.proxyPass = config.proxySettings.password || "";
            }
            this.isLoading = false;
        });
    }

    hideMe() {
        IpcService.hideMe();
    }

    openAppData() {
        IpcService.openAppData();
    }

    openDevTools() {
        IpcService.openDevTools();
    }

    clearCache() {
        this.isLoading = true;
        IpcService.clearCache();
    }

    generateLogs() {
        this.isLoadingDeterminate = true;
        this.generateLogsPercent = 0;
        IpcService.generateLogs();
    }

    diagnostic() {
        this.isDiagnosticRunning = true;
        IpcService.startDiagnostic();
        this.testClass[1] = ["forward", "slide-in-blurred-left checking"];
    }

    restartExplorer() {
        this.restartingExplorer = true;
        IpcService.restartExplorer()
            .then(() => {
                this.restartingExplorer = false;
            })
            .catch((e) => {
                this.restartingExplorer = false;
                this.buttonsErrorText = e;
            });
    }

    saveConfig() {
        this.configErrMsg = "";
        let config: IConfig = {
            serverUrl: new URL(this.serverUrl),
            keepWindowsAlive: this.keepWindowsAlive,
        };
        const proxySettingsPayload: IProxySettingsPayload = {
            isProxySettingsEnabled: this.isProxySettingsEnabled,
        };
        if (this.isProxySettingsEnabled) {
            if (this.bypassProxy) {
                Object.assign(proxySettingsPayload, {
                    bypassProxy: this.bypassProxy,
                    bypassAddresses: this.bypassAddresses,
                });
            } else {
                this.removeProtocol();
                Object.assign(proxySettingsPayload, {
                    bypassProxy: this.bypassProxy,
                    address: this.proxyAddress,
                    port: this.proxyPort,
                    username: this.proxyUser,
                    password: this.proxyPass,
                });
            }
        }
        config = Object.assign(config, {proxySettings: proxySettingsPayload});
        IpcService.saveConfig(config)
            .then(() => {
                // saved successfully
                this.isLoading = false;
                this.configErrMsg = "Please restart the App for changes to take effect";
            }).catch((e) => {
                // cant be saved! - error
                this.isLoading = false;
                if (typeof e === "string") {
                    this.configErrMsg = e;
                } else {
                    this.configErrMsg = "Cannot save config, please contact support@rooster-x.com";
                }
                console.log("error", e);
        });
    }

    installExcelAddin() {
        const payload = {url: this.addinInstallPath};
        IpcService.installExcelAddin(payload);
    }

    removeProtocol() {
        this.proxyAddress = this.proxyAddress.replace(/(^\w+:|^)\/\//, "");
    }

    toggleShowAdvanced() {
        if (!this.showAdvanced) {

            // get extended logs
            IpcService.getIsExtendedLogsActive()
                .then((res) => this.isExtendedLogsActive = res && res.value === 1)
                .catch(() => this.isExtendedLogsActive = false);

            // get allow all menu items
            IpcService.getIsShowAllMenuActive()
                .then((res) => this.isAllMenuItemsActive = res && res.value === 1)
                .catch(() => this.isAllMenuItemsActive = false);

            this.showAdvanced = true;
        } else {
            this.showAdvanced = false;
        }
    }

    toggleAllMenuItemsActive() {
        let enable = true;
        if (this.isAllMenuItemsActive) {
            enable = false;
        }
        IpcService.setIsShowAllMenuActive(enable)
            .then((res) => {
                // console.log(res);
                if (res && res.success) {
                    this.isAllMenuItemsActive = enable;
                } else {
                    console.error("could not set show all menu to " + enable);
                }
            })
            .catch(() => console.error("could not set show all menu to " + enable));
    }

    toggleExtendedLogsActive() {
        let enable = true;
        if (this.isExtendedLogsActive) {
            enable = false;
        }
        IpcService.setIsExtendedLogsActive(enable)
            .then((res) => {
                // console.log(res);
                if (res && res.success) {
                    this.isExtendedLogsActive = enable;
                } else {
                    console.error("could not set extended logs to " + enable);
                }
            })
            .catch(() => console.error("could not set extended logs to " + enable));
    }

    togglePreLoad(e) {
        setTimeout(() => {
            this.preLoadHistory = e.checked && this.keepWindowsAlive === true;
        }, 50);
    }

    toggleKeepWindowsAlive(e) {
        setTimeout(() => {
            if (e.checked) {
                this.keepWindowsAlive = true;
                this.preLoadHistory = true;
            } else {
                this.keepWindowsAlive = false;
                this.preLoadHistory = false;
            }
        }, 50);
    }

    private adjustHeight() {
        const appRootElement = document.getElementById("app-root");
        if (appRootElement && appRootElement.offsetHeight) {
            const tmpHeight = appRootElement.offsetHeight;
            if (tmpHeight !== this.componentHeight) {
                this.componentHeight = tmpHeight;
                IpcService.changeWindowHeight(tmpHeight);
            }
        }
    }
}
