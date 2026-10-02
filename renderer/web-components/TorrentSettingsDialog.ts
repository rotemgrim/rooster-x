import {LitElement, html, nothing} from "lit";
import {customElement, state} from "lit/decorators.js";
import {EngineService, type IEngineSettings} from "../services/engine.service";
import {modal} from "./dialog";

type NumberKey = {[K in keyof IEngineSettings]: IEngineSettings[K] extends number ? K : never}[keyof IEngineSettings];
type BoolKey = {[K in keyof IEngineSettings]: IEngineSettings[K] extends boolean ? K : never}[keyof IEngineSettings];

/** BitTorrent client settings. Fires "close" when done. */
@customElement("torrent-settings-dialog")
export class TorrentSettingsDialog extends LitElement {

    @state() private draft: IEngineSettings | null = null;
    @state() private error = "";

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        document.addEventListener("keydown", this.onKey);
        EngineService.getSettings()
            .then(s => (this.draft = s))
            .catch(err => (this.error = String(err)));
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("keydown", this.onKey);
    }

    private onKey = (e: KeyboardEvent) => e.key === "Escape" && this.close();

    private close() {
        this.dispatchEvent(new CustomEvent("close"));
    }

    private set<K extends keyof IEngineSettings>(key: K, value: IEngineSettings[K]) {
        if (this.draft) {
            this.draft = {...this.draft, [key]: value};
        }
    }

    private save(e: Event) {
        e.preventDefault();
        if (!this.draft) {
            return;
        }
        EngineService.saveSettings(this.draft)
            .then(() => this.close())
            .catch(err => (this.error = String(err)));
    }

    /** A number row; 0 shows as an empty box with the placeholder. */
    private number(d: IEngineSettings, key: NumberKey, label: string, unit = "", {decimals = false, placeholder = "no limit"} = {}) {
        const value = d[key];
        return html`<label>
            <span>${label}</span>
            <input type="number" min="0" step=${decimals ? "any" : "1"} placeholder=${placeholder}
                .value=${value ? String(value) : ""}
                @input=${(e: Event) => {
                    const n = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
                    this.set(key, decimals ? n : Math.round(n));
                }} />
            <span>${unit}</span>
        </label>`;
    }

    private checkbox(d: IEngineSettings, key: BoolKey, label: string) {
        return html`<label class="dl-check">
            <input type="checkbox" .checked=${d[key]}
                @change=${(e: Event) => this.set(key, (e.target as HTMLInputElement).checked)} />
            ${label}
        </label>`;
    }

    public render() {
        const d = this.draft;
        if (!d) {
            return this.error ? modal(() => this.close(), html`<div class="modal"><p class="dl-error">${this.error}</p></div>`) : nothing;
        }
        return modal(() => this.close(), html`<form class="modal torrent-settings" role="dialog" aria-modal="true" @submit=${this.save}>
            <h3>BitTorrent settings</h3>
            <h4>Seeding</h4>
            ${this.number(d, "seedDays", "Stop seeding after", "days", {decimals: true})}
            ${this.number(d, "ratioLimit", "or at share ratio", "", {decimals: true})}
            <label>
                <span>Then</span>
                <select .value=${d.seedEndAction}
                    @change=${(e: Event) => this.set("seedEndAction", (e.target as HTMLSelectElement).value === "remove" ? "remove" : "pause")}>
                    <option value="pause">Pause the torrent</option>
                    <option value="remove">Remove it from the list (keep files)</option>
                </select>
            </label>
            <h4>Speed</h4>
            ${this.number(d, "maxDownloadKiB", "Max download speed", "KiB/s")}
            ${this.number(d, "maxUploadKiB", "Max upload speed", "KiB/s")}
            <h4>Downloads</h4>
            ${this.number(d, "maxActiveDownloads", "Max active downloads")}
            ${this.number(d, "maxConnsPerTorrent", "Max connections per torrent", "", {placeholder: "50"})}
            ${this.checkbox(d, "sequentialByDefault", "New torrents download first & last parts first, then in order")}
            ${this.checkbox(d, "addPaused", "Add new torrents paused")}
            <p class="dl-hint">Empty or 0 means no limit. Seeding limits count from when a torrent finished or was last resumed.
                Torrents beyond the active download limit wait as Queued, oldest first.</p>
            ${this.error ? html`<p class="dl-error">${this.error}</p>` : nothing}
            <div class="modal-buttons">
                <button type="button" @click=${this.close}>Cancel</button>
                <button type="submit" class="primary">Save</button>
            </div>
        </form>`);
    }
}
