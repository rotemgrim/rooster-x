
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {RoosterXWrapper} from "./RoosterXWrapper";
import {User} from "../../entity/User";
import AppGlobal from "../../main/helpers/AppGlobal";

@customElement("user-login")
export class UserLogin extends LitElement {

    @property() public wrapper: RoosterXWrapper;
    @property() public _users: null | User[] = null;

    @property() public firstName: string = "";
    @property() public lastName: string = "";
    @property() public password: string = "";
    @property() public _errMsg: string = "";

    public createRenderRoot() {
        return this;
    }

    set users(users: User[] | null) {
        this._users = users;
        this.requestUpdate();
    }

    constructor() {
        super();
        this.loadUsers();
    }

    public loadUsers() {
        IpcService.getAllUsers().then(users => {
            console.log("users", users);
            this.users = users;
        });
    }

    public checkLoggedIn(user: User) {
        if (!this._users) {
            return false;
        }
        for (const u of this._users) {
            if (u && user && u.id === user.id) {
                this.wrapper.user = u;
                this.wrapper.isLoggedIn = true;
                return true;
            }
        }
        return false;
    }

    public login(user: User) {
        const config = this.wrapper.config;
        config.userId = user.id;
        IpcService.saveConfig(config)
            .then(() => this.checkLoggedIn(user))
            .catch(console.log);
    }

    private strToHslColor(str: string, saturation: number = 86, lightness: number = 32) {
        return "";
        // let hash = 0;
        // for (let i = 0; i < str.length; i++) {
        //     hash = str.charCodeAt(i) + ((hash << 5) - hash);
        // }
        // const h = hash % 360;
        // return `hsl(${h}, ${saturation}%, ${lightness}%)`;
    }

    public createAdmin() {
        const user = new User();
        user.firstName = this.firstName;
        user.lastName = this.lastName;
        user.password = this.password;
        user.isAdmin = true;
        IpcService.createUser(user)
            .then(() => {
                this.loadUsers();
            }).catch(e => {
                console.log(e);
                if (e && e.message && e.name) {
                    this._errMsg = `${e.name} -> ${e.message}`;
                } else {
                    this._errMsg = e;
                }
            });
    }

    public render() {
        let title = "Loading...";
        let form = html``;
        let button = html``;
        if (this._users && this._users.length === 0) {
            title = "Create Admin User";
            form = html`
            <input type="text" placeholder="First name" @change=${e => this.firstName = e.target.value} />
            <input type="text" placeholder="Last name" @change=${e => this.lastName = e.target.value} />
            <input type="text" placeholder="Password" @change=${e => this.password = e.target.value} />`;
            button = html`<button @click=${this.createAdmin}>Create</button>`;
        } else if (this._users && this._users.length > 0) {
            title = "User Login";
            form = html`${this._users.map((u) =>
                html`<button class="user-btn" @click=${() => this.login(u)}
                        style="background-color: ${this.strToHslColor(u.firstName)}">
                    <span class="initials">${u.firstName[0] + u.lastName[0]}</span>
                    <span class="first-name">${u.firstName}</span>
                </button>`)}`;
        }
        return html`
        <top-bar></top-bar>
        <div class="side-bar open"></div>
        <div class="panel">
            <div class="page user-page">
                <h1>${title}</h1>
                <div class="form">
                    ${form}
                    <br>
                    ${button}
                </div>
                <p class="errMsg" style="color: red;">${this._errMsg}</p>
            </div>
        </div>`;
    }
}
