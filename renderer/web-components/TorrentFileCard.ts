import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {type TorrentFile} from "../entity/TorrentFile";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import {EngineService, largestVideo, type IEngineStatus} from "../services/engine.service";
import {MediaFileCard} from "./MediaFileCard";
import {playTorrentFile} from "./RemotePlayPicker";

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
            EngineService.status(this.infoHash)
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
            EngineService.status(this.infoHash)
                .then(st => (this.engine = st))
                .catch(() => (this.engine = null))
                .finally(() => this.engine && this.poll());
        }, 2000);
    }

    public downloadInEngine() {
        if (this.engine) {
            return;
        }
        EngineService.add(this.torrentFile.magnet)
            .then(() => EngineService.status(this.infoHash))
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
        const video = largestVideo(this.engine?.files);
        if (video) {
            playTorrentFile(this.infoHash, video);
        }
    }

    private togglePause(e: Event) {
        e.stopPropagation();
        const paused = !this.engine.paused;
        EngineService.setPaused(this.infoHash, paused)
            .then(() => {
                this.engine = {...this.engine, paused};
                this.poll();
            })
            .catch(err => console.error("could not pause/resume", err));
    }

    private deleteDownload(e: Event) {
        e.stopPropagation();
        const name = this.engine?.name || this.torrentFile.raw;
        if (!window.confirm(`Delete "${name}" and its downloaded files?`)) {
            return;
        }
        EngineService.remove(this.infoHash, true)
            .then(() => {
                window.clearTimeout(this.pollTimer);
                this.engine = null;
            })
            .catch(err => console.error("could not delete download", err));
    }

    private toggleSequential(e: Event) {
        e.stopPropagation();
        const on = (e.target as HTMLInputElement).checked;
        EngineService.setSequential(this.infoHash, on)
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

    private renderPeers() {
        const {seeders, leechers, peersUpdatedAt} = this.torrentFile;
        if (seeders == null) {
            return "";
        }
        const health = seeders === 0 ? "dead" : seeders < 10 ? "low" : "good";
        const ageDays = peersUpdatedAt ? Math.floor((Date.now() / 1000 - peersUpdatedAt) / 86400) : null;
        const age = ageDays == null ? "" : ageDays === 0 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays} days ago`;
        return html`<div class="peers ${health}" title="${seeders} seeders, ${leechers ?? 0} leechers${age ? ` (updated ${age})` : ""}">
            <span>▲ ${seeders.toLocaleString()}</span>
            <span>▼ ${(leechers ?? 0).toLocaleString()}</span>
        </div>`;
    }

    private renderEngine() {
        const st = this.engine;
        if (!st) {
            return "";
        }
        const pct = st.hasInfo && st.length ? Math.floor((st.completed / st.length) * 100) : 0;
        const label = st.paused ? `paused · ${pct}%` : st.hasInfo ? `${pct}%` : "fetching info…";
        const canPlay = !!largestVideo(st.files);
        return html`<div class="engine-status" title="${st.seeders} seeders connected">
            ${label} · ${st.peers} peers
            ${canPlay ? html`<i class="material-icons engine-play" title="Play" @click=${this.play}>play_circle</i>` : ""}
        </div>
        <i class="material-icons engine-action" title="${st.paused ? "Resume download" : "Pause download"}"
            @click=${this.togglePause}>${st.paused ? "play_arrow" : "pause"}</i>
        <i class="material-icons engine-action engine-delete" title="Delete download and its files"
            @click=${this.deleteDownload}>delete</i>
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
                ${this.renderPeers()}
                ${this.renderEngine()}
                <i class="material-icons engine-external" title="Open magnet in external app" @click=${this.openExternally}>open_in_new</i>
            </div>
            ${this.renderChunks()}
        </div>`;
    }
}
