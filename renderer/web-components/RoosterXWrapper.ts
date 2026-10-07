import {LitElement, html, PropertyValues} from "lit";
import {customElement, property} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import "./RoosterX";
import "./SelectDataBase";
import "./UserLogin";
import "./SetupWizard";
import {IConfig} from "../common/models/IConfig";
import {type User} from "../entity/User";
import {type ISetupState} from "../common/models/ISetup";

@customElement("rooster-x-wrapper")
export class RoosterXWrapper extends LitElement {

    @property() public isLoggedIn: boolean = false;
    @property() public config: IConfig = {
        userId: 0,
        isAdmin: false,
    };
    @property() public user: User;
    @property() public setup: ISetupState | null = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();

        // check if user is already logged in localstorage
        const tmpUser = localStorage.getItem("user");
        if (tmpUser) {
            const user = JSON.parse(tmpUser);
            this.user = user;
            this.isLoggedIn = true;
            this.config.userId = user.id;
            this.config.isAdmin = user.isAdmin;
            IpcService.setUserId(user.id);
        }

        this.checkStatus();
        IpcService.getSetup()
            .then(setup => this.setup = setup)
            .catch(e => {
                console.log("could not get setup state", e);
                this.setup = {needsSetup: false};
            });
    }

    private setupDone() {
        this.isLoggedIn = false;
        this.setup = {needsSetup: false};
    }

    public checkStatus() {
        console.log("checking status");
        // if (this.isLoggedIn) {
        //
        // } else

        // IpcService.getConfig().then(config => {
        //     console.log("config", config);
        //     this.config = config;
        //
        //     // check if user is logged in
        //     if (config.userId) {
        //         IpcService.getUser(config.userId)
        //             .then(user => {
        //                 if (user) {
        //                     console.log("user", user);
        //                     this.user = user;
        //                     this.isLoggedIn = true;
        //                     this.requestUpdate();
        //                 } else {
        //                     this.isLoggedIn = false;
        //                 }
        //             })
        //             .catch(e => {
        //                 console.log(e);
        //                 this.isLoggedIn = false;
        //             });
        //     } else {
        //         this.isLoggedIn = false;
        //     }
        //
        // });
    }

    public render() {
        // if (!this.hasDbPath) {
        //     return html`<select-database .wrapper=${this}></select-database>`;
        // } else if (!this.isLoggedIn) {
        //     return html`<user-login .wrapper=${this}></user-login>`;
        // }
        if (!this.setup) {
            return html``;
        }
        if (this.setup.needsSetup) {
            return html`<setup-wizard .config=${this.setup.config} .users=${this.setup.users}
                .onDone=${() => this.setupDone()}></setup-wizard>`;
        }
        if (!this.isLoggedIn) {
            return html`<user-login .wrapper=${this}></user-login>`;
        }
        return html`<rooster-x .user=${this.user} .config=${this.config} .wrapper=${this}></rooster-x>`;
    }
}
