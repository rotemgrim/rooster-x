
import {LitElement, html, customElement, property} from "lit-element";
import {MediaFile} from "../../entity/MediaFile";
import {shell} from "electron";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import * as path from "path";

@customElement("media-file-card")
export class MediaFileCard extends LitElement {

    @property() public mediaFile: MediaFile;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public playFile() {
        this.dispatchEvent(new CustomEvent("playMedia", {detail: this.mediaFile}));
    }

    public static fileOptions(file: MediaFile) {
        return html`<span>${file.raw}</span>`;
    }

    private showInFolder() {
        // IpcService.openExternal(path.dirname(this.mediaFile.path));
        shell.showItemInFolder(this.mediaFile.path);
    }

    public render() {
        return html`<div @click=${this.playFile} class="media-file" title="${this.mediaFile.path}">
            <i class="material-icons">play_circle_outline</i>
            ${this.mediaFile.resolution ? html`<div class="resolution">${this.mediaFile.resolution}</div>` : ""}
            ${this.mediaFile.audio ? html`<div class="audio">${this.mediaFile.audio}</div>` : ""}
            ${this.mediaFile.quality ? html`<div class="quality">${this.mediaFile.quality}</div>` : ""}
            ${this.mediaFile.raw ? html`<div class="raw">${this.mediaFile.raw}</div>` : ""}
            <div class="open-folder"
                @click=${this.showInFolder} style="float: right;">
                <i class="material-icons">folder</i>
            </div>
        </div>`;
    }
}
