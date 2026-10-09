import {LitElement, html, nothing} from "lit";
import {customElement, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {AGE_LIMITS, ageLimitLabel, type User} from "../entity/User";
import {currentUser} from "../common/session";

const NEW_USER: User = {id: 0, firstName: "", lastName: "", isAdmin: false, maxAge: null};

/** Adds, edits and removes profiles; in Settings for admins, and in the setup wizard. */
@customElement("user-profiles")
export class UserProfiles extends LitElement {

    @state() private users: User[] = [];
    // The profile being added (id 0) or edited.
    @state() private draft: User | null = null;
    @state() private error = "";

    public createRenderRoot() {
        return this;
    }

    connectedCallback() {
        super.connectedCallback();
        IpcService.getAllUsers().then(users => this.users = users).catch(e => this.error = String(e));
    }

    /** Resolves to whether the change went through. */
    private async run(action: Promise<User[]>) {
        this.error = "";
        try {
            this.users = await action;
            this.draft = null;
            return true;
        } catch (e) {
            this.error = String(e);
            return false;
        }
    }

    private async save(e: Event) {
        e.preventDefault();
        const d = this.draft!;
        const saved = await this.run(d.id ? IpcService.updateUser(d) : IpcService.createUser(d));
        if (saved && d.id === currentUser()?.id) {
            // the app picks up the new settings of the profile in use when it loads
            location.reload();
        }
    }

    private removeUser(user: User) {
        if (window.confirm(`Remove ${user.firstName}, with their watched history and lists?`)) {
            this.run(IpcService.deleteUser(user.id));
        }
    }

    private renderForm(d: User) {
        const set = (patch: Partial<User>) => this.draft = {...this.draft!, ...patch};
        return html`<form class="user-form" @submit=${this.save}>
            <input type="text" placeholder="First name" .value=${d.firstName}
                @input=${(e: InputEvent) => set({firstName: (e.target as HTMLInputElement).value})}>
            <input type="text" placeholder="Last name" .value=${d.lastName}
                @input=${(e: InputEvent) => set({lastName: (e.target as HTMLInputElement).value})}>
            <select title="Only movies and series rated for this age show up, and nothing unrated"
                    @change=${(e: Event) => {
                        const v = (e.target as HTMLSelectElement).value;
                        set({maxAge: v === "" ? null : Number(v)});
                    }}>
                ${AGE_LIMITS.map(a => html`<option value=${a ?? ""} ?selected=${a === d.maxAge}>${ageLimitLabel(a)}</option>`)}
            </select>
            <label class="check"><input type="checkbox" .checked=${d.isAdmin}
                @change=${(e: Event) => set({isAdmin: (e.target as HTMLInputElement).checked})}> Admin</label>
            <button type="submit" ?disabled=${!d.firstName.trim()}>${d.id ? "Save" : "Add"}</button>
            <button type="button" @click=${() => this.draft = null}>Cancel</button>
        </form>`;
    }

    public render() {
        // nobody during setup
        const me = currentUser()?.id;
        return html`<div class="user-profiles">
            <ul>
                ${this.users.map(u => this.draft?.id === u.id ? html`<li>${this.renderForm(this.draft)}</li>` : html`<li>
                    <i class="material-icons">person</i>
                    <span class="name">${u.firstName} ${u.lastName}</span>
                    <span class="badge">${ageLimitLabel(u.maxAge)}</span>
                    ${u.isAdmin ? html`<span class="badge">admin</span>` : nothing}
                    <button class="icon-btn" title="Edit" @click=${() => this.draft = {...u}}>
                        <i class="material-icons">edit</i></button>
                    ${u.id === me ? nothing : html`<button class="icon-btn" title="Remove" @click=${() => this.removeUser(u)}>
                        <i class="material-icons">delete</i></button>`}
                </li>`)}
                ${this.draft?.id === 0 ? html`<li>${this.renderForm(this.draft)}</li>` : nothing}
            </ul>
            ${this.draft ? nothing : html`<button class="secondary" @click=${() => this.draft = {...NEW_USER}}>Add user</button>`}
            ${this.error ? html`<p class="error">${this.error}</p>` : nothing}
        </div>`;
    }
}
