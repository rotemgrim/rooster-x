import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {EngineService, fileProgress, videosOf, type IEngineFile} from "../services/engine.service";
import {chunksBar} from "./chunks";
import {modal} from "./dialog";
import {playTorrentFile} from "./RemotePlayPicker";

/**
 * Plays a downloading torrent: its only video at once, or, when it has
 * several (a season pack), a list of them to pick from.
 */
export function playTorrent(infoHash: string, files: IEngineFile[] | null | undefined) {
    const videos = videosOf(files);
    if (videos.length > 1) {
        const picker = document.createElement("torrent-file-picker") as TorrentFilePicker;
        picker.infoHash = infoHash;
        picker.files = videos;
        document.body.appendChild(picker);
    } else if (videos[0]) {
        playTorrentFile(infoHash, videos[0]);
    }
}

@customElement("torrent-file-picker")
export class TorrentFilePicker extends LitElement {

    @property({attribute: false}) public infoHash = "";
    @property({attribute: false}) public files: IEngineFile[] = [];
    private pollTimer: number | undefined;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        window.clearTimeout(this.pollTimer);
    }

    /** Fetches the chunk maps, which only EngineService.status has, while the list is open. */
    private refresh() {
        EngineService.status(this.infoHash)
            .then(st => (this.files = videosOf(st.files)))
            .catch(err => console.error("could not get torrent status", err))
            .finally(() => {
                if (this.isConnected) {
                    this.pollTimer = window.setTimeout(() => this.refresh(), 2000);
                }
            });
    }

    private play(file: IEngineFile) {
        this.remove();
        playTorrentFile(this.infoHash, file);
    }

    public render() {
        return modal(() => this.remove(), html`<div class="modal action-sheet" role="dialog" aria-modal="true">
            <h3>Play which file?</h3>
            <div class="tfp-list">
                ${this.files.map(f => html`<button title=${f.path} @click=${() => this.play(f)}>
                    <i class="material-icons">play_circle</i>
                    <span class="tfp-name">${f.path.split("/").pop()}</span>
                    <span class="tfp-pct">${Math.floor(fileProgress(f) * 100)}%</span>
                    ${chunksBar(f.chunks)}
                </button>`)}
            </div>
            <div class="modal-buttons">
                <button @click=${() => this.remove()}>Cancel</button>
            </div>
        </div>`);
    }
}
