
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";

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
            </div>
        </div>`;
    }
}
