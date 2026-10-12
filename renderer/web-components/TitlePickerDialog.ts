import {LitElement, html, nothing} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService, type ITitleChoice, type ITitleChoices} from "../services/ipc.service";
import {type TorrentFile} from "../entity/TorrentFile";
import {modal} from "./dialog";

/** Picks the title a torrent that was matched to the wrong one belongs to.
 * Fires "moved" once the torrent has its new title, and "close". */
@customElement("title-picker-dialog")
export class TitlePickerDialog extends LitElement {

    @property({attribute: false}) public torrentFile: TorrentFile;

    @state() private query = "";
    @state() private found: ITitleChoices | null = null;
    @state() private searching = false;
    // the title being linked to, 0 for the automatic pick
    @state() private moving: number | null = null;
    @state() private error = "";

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        document.addEventListener("keydown", this.onKey);
        // an empty query searches for the torrent's own name
        this.search();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("keydown", this.onKey);
    }

    private onKey = (e: KeyboardEvent) => e.key === "Escape" && this.close();

    private close() {
        if (this.moving === null) {
            this.dispatchEvent(new CustomEvent("close"));
        }
    }

    private search(e?: Event) {
        e?.preventDefault();
        this.searching = true;
        this.error = "";
        IpcService.searchTorrentTitles(this.torrentFile.id, this.query.trim())
            .then(found => {
                this.found = found;
                if (!this.query) {
                    this.query = found.name;
                }
            })
            .catch(err => (this.error = `Could not search: ${err?.message ?? err}`))
            .finally(() => (this.searching = false));
    }

    /** Links the torrent to tmdbId, or to the best other match TMDB finds when it is 0. */
    private move(tmdbId: number) {
        if (this.moving !== null) {
            return;
        }
        this.moving = tmdbId;
        this.error = "";
        IpcService.rematchTorrent(this.torrentFile.id, tmdbId || undefined)
            .then(res => {
                this.moving = null;
                this.dispatchEvent(new CustomEvent("moved", {detail: res}));
            })
            .catch(err => {
                this.moving = null;
                this.error = `${err?.message ?? err}`;
            });
    }

    private renderChoice(c: ITitleChoice) {
        const busy = this.moving === c.tmdbId;
        return html`<button type="button" class="title-choice ${c.isCurrent ? "current" : ""}"
            ?disabled=${c.isCurrent || this.moving !== null}
            title=${c.overview ?? ""}
            @click=${() => this.move(c.tmdbId)}>
            ${c.poster
                ? html`<img src="https://image.tmdb.org/t/p/w92${c.poster}" alt="" loading="lazy" />`
                : html`<div class="no-poster"><i class="material-icons">movie</i></div>`}
            <div class="title-choice-text">
                <strong>${c.title}</strong>${c.year ? html` <span class="year">(${c.year})</span>` : nothing}
                ${c.originalTitle ? html`<div class="original">${c.originalTitle}</div>` : nothing}
                ${c.isCurrent ? html`<div class="note">Its title now</div>` : nothing}
                ${c.overview ? html`<p>${c.overview}</p>` : nothing}
            </div>
            ${busy ? html`<i class="material-icons rotate-center">sync</i>` : nothing}
        </button>`;
    }

    public render() {
        const found = this.found;
        return modal(() => this.close(), html`<div class="modal title-picker" role="dialog" aria-modal="true">
            <h3>Which title is this?</h3>
            <p class="raw">${this.torrentFile.raw}</p>
            ${found && found.siblings > 0
                ? html`<p class="siblings">The ${found.siblings} other torrent${found.siblings === 1 ? "" : "s"}
                      named “${found.name}” on this title move along with it.</p>`
                : nothing}
            <form class="title-search" @submit=${this.search}>
                <input type="search" placeholder="Search TMDB" .value=${this.query}
                    @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)} />
                <button type="submit" ?disabled=${this.searching}>Search</button>
            </form>
            <div class="title-choices">
                ${this.searching
                    ? html`<p class="note">Searching…</p>`
                    : found && found.choices.length === 0
                      ? html`<p class="note">Nothing found. Try another name.</p>`
                      : found?.choices.map(c => this.renderChoice(c))}
            </div>
            ${this.error ? html`<p class="dl-error">${this.error}</p>` : nothing}
            <div class="modal-buttons">
                <button type="button" ?disabled=${this.moving !== null}
                    title="Search again by the torrent's name, leaving out the title it has now"
                    @click=${() => this.move(0)}>
                    ${this.moving === 0 ? "Picking…" : "Pick for me"}
                </button>
                <button type="button" ?disabled=${this.moving !== null} @click=${this.close}>Cancel</button>
            </div>
        </div>`);
    }
}
