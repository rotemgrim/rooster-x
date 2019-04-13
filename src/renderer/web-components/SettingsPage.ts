
import {css, LitElement, html, customElement, property} from "lit-element";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";

@customElement("settings-page")
export class SettingsPage extends LitElement {

    @property() public rooster: RoosterX;
    @property() public scanDir: string;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    private close() {
        this.rooster.closeSideBar();
    }

    private scanNow() {
        IpcService.scanDir({dir: this.scanDir})
            .then(res => console.log(res))
            .catch(console.log);
    }

    public render() {
        return html`<div class="page filters-page">
            <div class="page-top">
                <h1>Settings</h1>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                <div class="section">
                    <h2>Scan Directories under</h2>
                    <input type="text" @input=${(e) => this.scanDir = e.target.value}>
                    <button @click=${this.scanNow}>Scan Now!</button>
                </div>
                <div class="section">
                    <h2>Rescan Policy</h2>
                    <p>Some configuration for every time to scan?</p>
                </div>
                ${this.rooster.user.isAdmin ?
                    html`<div class="section">
                    <h2>Add User</h2>
                </div>` : ""}
            </div>
        </div>`;
    }
}
