import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {EngineService, fileProgress, videosOf, type IEngineFile} from "../services/engine.service";
import {chunksBar} from "./chunks";
import {modal} from "./dialog";
import {FoldedSeasons, seasonList} from "./season-groups";
import {playTorrentFile} from "./RemotePlayPicker";

/**
 * Plays a downloading torrent: its only video at once, or, when it has
 * several (a season pack), a list of them to pick from.
 */
export function playTorrent(infoHash: string) {
    EngineService.status(infoHash)
        .then(st => {
            const videos = videosOf(st.files);
            if (videos.length > 1) {
                const picker = document.createElement("torrent-file-picker") as TorrentFilePicker;
                picker.infoHash = infoHash;
                picker.files = videos;
                document.body.appendChild(picker);
            } else if (videos[0]) {
                playTorrentFile(infoHash, videos[0]);
            }
        })
        .catch(err => console.error("could not get torrent status", err));
}

@customElement("torrent-file-picker")
export class TorrentFilePicker extends LitElement {

    @property({attribute: false}) public infoHash = "";
    @property({attribute: false}) public files: IEngineFile[] = [];
    private folded = new FoldedSeasons(this, () => `torrent:${this.infoHash}`);
    private pollTimer: number | undefined;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.poll();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        window.clearTimeout(this.pollTimer);
    }

    /** Keeps the files' chunk maps fresh while the list is open. */
    private poll() {
        this.pollTimer = window.setTimeout(() => {
            EngineService.status(this.infoHash)
                .then(st => (this.files = videosOf(st.files)))
                .catch(err => console.error("could not get torrent status", err))
                .finally(() => {
                    if (this.isConnected) {
                        this.poll();
                    }
                });
        }, 2000);
    }

    private play(file: IEngineFile) {
        this.remove();
        playTorrentFile(this.infoHash, file);
    }

    private fileButton(f: IEngineFile) {
        return html`<button title=${f.path} @click=${() => this.play(f)}>
            <i class="material-icons">play_circle</i>
            <span class="tfp-name">${f.path.split("/").pop()}</span>
            <span class="tfp-pct">${f.skipped ? "skipped" : `${Math.floor(fileProgress(f) * 100)}%`}</span>
            ${chunksBar(f.chunks)}
        </button>`;
    }

    public render() {
        // by season, the files without one last, each season in path order
        const rank = (f: IEngineFile) => f.season || Number.MAX_SAFE_INTEGER;
        const files = [...this.files].sort((a, b) => rank(a) - rank(b));
        return modal(() => this.remove(), html`<div class="modal action-sheet" role="dialog" aria-modal="true">
            <h3>Play which file?</h3>
            <div class="tfp-list">
                ${seasonList(files, {
                    season: f => f.season ?? 0,
                    label: season => (season ? `Season ${season}` : "Other"),
                    item: f => this.fileButton(f),
                    folded: this.folded,
                })}
            </div>
            <div class="modal-buttons">
                <button @click=${() => this.remove()}>Cancel</button>
            </div>
        </div>`);
    }
}
