import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {type TorrentFile} from "../entity/TorrentFile";
import {RoosterX} from "./RoosterX";
import {IpcService, type IEngineStatus} from "../services/ipc.service";
import {MediaFileCard} from "./MediaFileCard";

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv)$/i;

@customElement("torrent-file-card")
export class TorrentFileCard extends LitElement {

    @property() public torrentFile: TorrentFile;

    @state() private engine: IEngineStatus | null = null;
    private pollTimer: number | undefined;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    private get infoHash(): string {
        const m = /btih:([a-f0-9]{40})/i.exec(this.torrentFile?.magnet ?? "");
        return m ? m[1].toLowerCase() : "";
    }

    public connectedCallback() {
        super.connectedCallback();
        // pick up torrents that are already downloading in the engine
        if (this.infoHash) {
            IpcService.engineStatus(this.infoHash)
                .then(st => {
                    this.engine = st;
                    this.poll();
                })
                .catch(() => {});
        }
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        window.clearTimeout(this.pollTimer);
    }

    private poll() {
        window.clearTimeout(this.pollTimer);
        if (this.engine && this.engine.hasInfo && this.engine.completed >= this.engine.length) {
            return;
        }
        this.pollTimer = window.setTimeout(() => {
            IpcService.engineStatus(this.infoHash)
                .then(st => (this.engine = st))
                .catch(() => (this.engine = null))
                .finally(() => this.engine && this.poll());
        }, 2000);
    }

    public downloadInEngine() {
        if (this.engine) {
            return;
        }
        IpcService.engineAdd(this.torrentFile.magnet)
            .then(() => IpcService.engineStatus(this.infoHash))
            .then(st => {
                this.engine = st;
                this.poll();
            })
            .catch(err => console.error("engine add failed", err));
    }

    public openExternally(e: Event) {
        e.stopPropagation();
        IpcService.openExternal(this.torrentFile.magnet);
    }

    private play(e: Event) {
        e.stopPropagation();
        const files = (this.engine?.files ?? []).filter(f => VIDEO_EXT.test(f.path));
        if (!files.length) {
            return;
        }
        const f = files.reduce((a, b) => (b.length > a.length ? b : a));
        const name = encodeURIComponent(f.path.split("/").pop());
        // plain http on the same host the UI was opened from; mpv rejects the
        // self-signed cert used on :8443
        IpcService.openInMPV(`http://${location.hostname}:8080/engine/stream/${this.infoHash}/${f.index}/${name}`);
    }

    private toggleSequential(e: Event) {
        e.stopPropagation();
        const on = (e.target as HTMLInputElement).checked;
        IpcService.engineSetSequential(this.infoHash, on)
            .then(() => (this.engine = {...this.engine, sequential: on}))
            .catch(err => console.error("could not change download order", err));
    }

    private renderChunks() {
        const chunks = this.engine?.files?.find(f => f.chunks)?.chunks;
        if (!chunks) {
            return "";
        }
        // one gradient stop pair per 1% slice; brightness = how complete it is
        const step = 100 / chunks.length;
        const stops = [...chunks].map((c, i) => {
            const color = `rgba(107, 236, 93, ${(+c / 9).toFixed(2)})`;
            return `${color} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`;
        });
        const ready = chunks.search(/[^9]/);
        const readyPct = ready === -1 ? 100 : ready;
        return html`<div class="engine-chunks"
            title="${readyPct}% downloaded from the start"
            style="background: linear-gradient(to right, ${stops.join(", ")}), rgba(0, 0, 0, 0.45)"></div>`;
    }

    private renderEngine() {
        const st = this.engine;
        if (!st) {
            return "";
        }
        const pct = st.hasInfo && st.length ? Math.floor((st.completed / st.length) * 100) : 0;
        const label = st.hasInfo ? `${pct}%` : "fetching info…";
        const canPlay = (st.files ?? []).some(f => VIDEO_EXT.test(f.path));
        return html`<div class="engine-status" title="${st.seeders} seeders connected">
            ${label} · ${st.peers} peers
            ${canPlay ? html`<i class="material-icons engine-play" title="Stream in mpv" @click=${this.play}>play_circle</i>` : ""}
        </div>
        <label class="engine-seq" @click=${(e: Event) => e.stopPropagation()}
            title="Download the first and last parts of the video first, then the rest in order from start to end, so it can be played while downloading">
            <input type="checkbox" .checked=${st.sequential} @change=${this.toggleSequential} />
            <span>First &amp; last parts first, then in order</span>
        </label>`;
    }

    public static fileOptions(file: TorrentFile) {
        return html`<span>${file.title}</span>`;
    }

    public render() {
        const qTier = MediaFileCard.qualityTier(this.torrentFile.quality);
        const rTier = MediaFileCard.resolutionTier(this.torrentFile.resolution);
        return html`<div @click=${this.downloadInEngine} class="torrent-file" title="${this.engine ? this.torrentFile.raw : "Download in RoosterX"}">
            ${this.torrentFile.title ? html`<div class="raw">${this.torrentFile.raw}</div>` : ""}
            <div class="torrent-controls">
                <i class="material-icons">${this.engine ? "downloading" : "cloud_download"}</i>
                ${this.torrentFile.resolution ? html`<div class="resolution ${rTier}">${this.torrentFile.resolution}</div>` : ""}
                ${this.torrentFile.audio ? html`<div class="audio">${this.torrentFile.audio}</div>` : ""}
                ${this.torrentFile.quality ? html`<div class="quality ${qTier}">${this.torrentFile.quality}</div>` : ""}
                ${this.renderEngine()}
                <i class="material-icons engine-external" title="Open magnet in external app" @click=${this.openExternally}>open_in_new</i>
            </div>
            ${this.renderChunks()}
        </div>`;
    }
}
