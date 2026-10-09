import {LitElement, html} from "lit";
import {customElement, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import "./RoosterX";
import "./UserLogin";
import "./SetupWizard";
import {type User} from "../entity/User";
import {type ISetupState} from "../common/models/ISetup";
import {currentUser, savedUserId, setCurrentUser} from "../common/session";

@customElement("rooster-x-wrapper")
export class RoosterXWrapper extends LitElement {

    @state() private setup: ISetupState | null = null;
    // Every profile, for the login screen.
    @state() private users: User[] | null = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getSetup()
            .catch(e => {
                console.log("could not get setup state", e);
                return {needsSetup: false};
            })
            .then(setup => {
                this.setup = setup;
                if (!setup.needsSetup) {
                    this.loadUsers();
                }
            });
    }

    /** Logs back in as the profile picked last time, with its current settings, if it still exists. */
    private loadUsers() {
        IpcService.getAllUsers()
            .then(users => {
                this.users = users;
                const saved = users.find(u => u.id === savedUserId());
                if (saved) {
                    this.login(saved);
                }
            })
            .catch(e => {
                console.log("could not get users", e);
                this.users = [];
            });
    }

    public login(user: User) {
        setCurrentUser(user);
        this.requestUpdate();
    }

    private setupDone() {
        this.setup = {needsSetup: false};
        this.loadUsers();
    }

    public render() {
        if (!this.setup) {
            return html``;
        }
        if (this.setup.needsSetup) {
            return html`<setup-wizard .config=${this.setup.config} .onDone=${() => this.setupDone()}></setup-wizard>`;
        }
        if (!currentUser()) {
            return html`<user-login .users=${this.users} .onPick=${(u: User) => this.login(u)}></user-login>`;
        }
        return html`<rooster-x></rooster-x>`;
    }
}
