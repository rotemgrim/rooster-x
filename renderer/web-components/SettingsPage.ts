
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import "./UserProfiles";
import {loggedInUser} from "../common/session";

@customElement("settings-page")
export class SettingsPage extends LitElement {

    @property({attribute: false}) public rooster: RoosterX;

    public createRenderRoot() {
        return this;
    }

    private close() {
        this.rooster.closeSidePanel();
    }

    private fullSweep() {
        IpcService.fullFilesScan();
    }

    private syncTorrents() {
        IpcService.syncTorrents();
    }

    private reprocessGenres() {
        IpcService.reprocessGenres()
            .then(() => {
                this.rooster.reloadInPlace();
            }).catch(console.log);
    }

    public render() {
        return html`<div class="page filters-page">
            <div class="page-top">
                <h1>Settings</h1>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                <div class="section">
                    <button @click="${this.fullSweep}">Full system sweep</button>
                    <button @click="${this.syncTorrents}">Sync Torrents</button>
                </div>
                <br>
                <button @click=${this.reprocessGenres}>Reprocess all Genres</button>
                ${loggedInUser().isAdmin ? html`<section class="settings-users">
                    <h2>Users</h2>
                    <p class="hint">Profiles with an age limit only see movies and series rated for their age (nothing
                        unrated) and have no Downloads.</p>
                    <user-profiles></user-profiles>
                </section>` : ""}
            </div>
        </div>`;
    }
}
