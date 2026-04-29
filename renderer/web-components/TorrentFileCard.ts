
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {type TorrentFile} from "../entity/TorrentFile";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import {MediaFileCard} from "./MediaFileCard";

@customElement("torrent-file-card")
export class TorrentFileCard extends LitElement {

    @property() public torrentFile: TorrentFile;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public downLoadTorrent() {
        IpcService.openExternal(this.torrentFile.magnet);
    }

    public static fileOptions(file: TorrentFile) {
        return html`<span>${file.title}</span>`;
    }

    public render() {
        const qTier = MediaFileCard.qualityTier(this.torrentFile.quality);
        const rTier = MediaFileCard.resolutionTier(this.torrentFile.resolution);
        return html`<div @click=${this.downLoadTorrent} class="torrent-file" title="${this.torrentFile.magnet}">
            <i class="material-icons">cloud_download</i>
            ${this.torrentFile.resolution ? html`<div class="resolution ${rTier}">${this.torrentFile.resolution}</div>` : ""}
            ${this.torrentFile.audio ? html`<div class="audio">${this.torrentFile.audio}</div>` : ""}
            ${this.torrentFile.quality ? html`<div class="quality ${qTier}">${this.torrentFile.quality}</div>` : ""}
            ${this.torrentFile.title ? html`<div class="raw">${this.torrentFile.raw}</div>` : ""}
        </div>`;
    }
}
