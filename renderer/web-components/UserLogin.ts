import {LitElement, html, nothing} from "lit";
import {customElement, property} from "lit/decorators.js";
import {ageLimitLabel, isLimited, type User} from "../entity/User";

/** The profile picker shown when nobody is logged in. Admins add profiles in Settings. */
@customElement("user-login")
export class UserLogin extends LitElement {

    @property({attribute: false}) public users: User[] | null = null;
    @property({attribute: false}) public onPick: (user: User) => void;

    public createRenderRoot() {
        return this;
    }

    public render() {
        const title = !this.users ? "Loading..." : this.users.length ? "Who's watching?" : "No users yet";
        return html`
        <top-bar></top-bar>
        <div class="side-bar open"></div>
        <div class="panel">
            <div class="page user-page">
                <h1>${title}</h1>
                <div class="form">
                    ${(this.users || []).map(u =>
                        html`<button class="user-btn" @click=${() => this.onPick(u)}>
                            <span class="initials">${(u.firstName?.[0] || "") + (u.lastName?.[0] || "")}</span>
                            <span class="first-name">${u.firstName}</span>
                            ${isLimited(u) ? html`<span class="badge" title=${ageLimitLabel(u.maxAge)}>up to ${u.maxAge}</span>`
                                : u.isAdmin ? html`<span class="badge">admin</span>` : nothing}
                        </button>`)}
                </div>
            </div>
        </div>`;
    }
}
