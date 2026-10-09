import {LitElement, html} from "lit";
import {customElement, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import "./RoosterX";
import "./UserLogin";
import "./SetupWizard";
import {type User} from "../entity/User";
import {type ISetupState} from "../common/models/ISetup";

const USER_KEY = "user";

@customElement("rooster-x-wrapper")
export class RoosterXWrapper extends LitElement {

    // The logged-in user, remembered in localStorage across reloads.
    @state() private user: User | null = null;
    @state() private setup: ISetupState | null = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();

        const saved = localStorage.getItem(USER_KEY);
        if (saved) {
            this.login(JSON.parse(saved));
        }

        IpcService.getSetup()
            .then(setup => this.setup = setup)
            .catch(e => {
                console.log("could not get setup state", e);
                this.setup = {needsSetup: false};
            });
    }

    public login(user: User) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        IpcService.setUserId(user.id);
        this.user = user;
    }

    private setupDone() {
        this.user = null;
        this.setup = {needsSetup: false};
    }

    public render() {
        if (!this.setup) {
            return html``;
        }
        if (this.setup.needsSetup) {
            return html`<setup-wizard .config=${this.setup.config} .users=${this.setup.users}
                .onDone=${() => this.setupDone()}></setup-wizard>`;
        }
        if (!this.user) {
            return html`<user-login .wrapper=${this}></user-login>`;
        }
        return html`<rooster-x .user=${this.user}></rooster-x>`;
    }
}
