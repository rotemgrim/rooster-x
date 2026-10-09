import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {RoosterXWrapper} from "./RoosterXWrapper";
import {type User} from "../entity/User";

@customElement("user-login")
export class UserLogin extends LitElement {

    @property({attribute: false}) public wrapper: RoosterXWrapper;
    @state() private users: null | User[] = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getAllUsers().then(users => this.users = users);
    }

    public render() {
        // Users are created by the setup wizard.
        const title = !this.users ? "Loading..." : this.users.length ? "User Login" : "No users yet";
        return html`
        <top-bar></top-bar>
        <div class="side-bar open"></div>
        <div class="panel">
            <div class="page user-page">
                <h1>${title}</h1>
                <div class="form">
                    ${(this.users || []).map(u =>
                        html`<button class="user-btn" @click=${() => this.wrapper.login(u)}>
                            <span class="initials">${(u.firstName?.[0] || "") + (u.lastName?.[0] || "")}</span>
                            <span class="first-name">${u.firstName}</span>
                        </button>`)}
                </div>
            </div>
        </div>`;
    }
}
