
import {LitElement, html, customElement, property} from "lit-element";
import {type TorrentFile} from "../../entity/TorrentFile";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";

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
        IpcService.openExternal(`magnet:?xt=urn:btih:${this.torrentFile.magnet}&dn=${this.torrentFile.raw}`);
    }

    public static fileOptions(file: TorrentFile) {
        return html`<span>${file.title}</span>`;
    }

    public render() {
        return html`<div @click=${this.downLoadTorrent} class="torrent-file" title="${this.torrentFile.magnet}">
            <i class="material-icons">cloud_download</i>
            ${this.torrentFile.resolution ? html`<div class="resolution">${this.torrentFile.resolution}</div>` : ""}
            ${this.torrentFile.audio ? html`<div class="audio">${this.torrentFile.audio}</div>` : ""}
            ${this.torrentFile.quality ? html`<div class="quality">${this.torrentFile.quality}</div>` : ""}
            ${this.torrentFile.title ? html`<div class="raw">${this.torrentFile.raw}</div>` : ""}
        </div>`;
    }
}
