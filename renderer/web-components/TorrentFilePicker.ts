import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
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

/** The season of an episode file, from "S02E05" or "2x05" in its name or a "Season 2" or "S02" folder; null if it has none. */
function seasonOf(path: string): number | null {
    const name = path.split("/").pop() ?? "";
    const m = /(?<![a-z\d])S(\d{1,2})[ ._-]?E\d/i.exec(name)
        ?? /(?<!\d)(\d{1,2})x\d{2}(?!\d)/.exec(name)
        ?? /season[ ._-]?(\d{1,2})(?!\d)/i.exec(path)
        ?? /(?:^|\/)S(\d{1,2})(?:\/|$)/i.exec(path);
    return m ? Number(m[1]) : null;
}

/** Files by season, in season order, with the ones without a season last. */
function bySeason(files: IEngineFile[]): [number | null, IEngineFile[]][] {
    const groups = new Map<number | null, IEngineFile[]>();
    for (const f of files) {
        const season = seasonOf(f.path);
        groups.set(season, [...(groups.get(season) ?? []), f]);
    }
    return [...groups].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity));
}

@customElement("torrent-file-picker")
export class TorrentFilePicker extends LitElement {

    @property({attribute: false}) public infoHash = "";
    @property({attribute: false}) public files: IEngineFile[] = [];
    @state() private collapsed = new Set<number | null>();
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

    private toggle(season: number | null) {
        const collapsed = new Set(this.collapsed);
        if (!collapsed.delete(season)) {
            collapsed.add(season);
        }
        this.collapsed = collapsed;
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
        const seasons = bySeason(this.files);
        return modal(() => this.remove(), html`<div class="modal action-sheet" role="dialog" aria-modal="true">
            <h3>Play which file?</h3>
            <div class="tfp-list">
                ${seasons.length < 2 ? this.files.map(f => this.fileButton(f)) : seasons.map(([season, files]) => {
                    const open = !this.collapsed.has(season);
                    return html`<button class="tfp-season" aria-expanded=${open} @click=${() => this.toggle(season)}>
                        <i class="material-icons">${open ? "expand_more" : "chevron_right"}</i>
                        <span class="tfp-name">${season === null ? "Other" : `Season ${season}`}</span>
                        <span class="tfp-pct">${files.length}</span>
                    </button>
                    ${open ? files.map(f => this.fileButton(f)) : ""}`;
                })}
            </div>
            <div class="modal-buttons">
                <button @click=${() => this.remove()}>Cancel</button>
            </div>
        </div>`);
    }
}
