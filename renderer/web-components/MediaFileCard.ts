
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {type MediaFile} from "../entity/MediaFile";
import {IpcService} from "../services/ipc.service";

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
        // get the directory path on the os (support for windows and linux)
        let dirPath = this.mediaFile.path.substring(0, this.mediaFile.path.lastIndexOf("/"));
        if (dirPath === "") {
            dirPath = this.mediaFile.path.substring(0, this.mediaFile.path.lastIndexOf("\\"));
        }
        IpcService.openExternal(dirPath);
        // shell.showItemInFolder(this.mediaFile.path);
        console.log("show in folder", dirPath);
    }

    public render() {
        return html`<div tabindex="0" @click=${this.playFile} class="media-file" title="${this.mediaFile.path}">
            <i class="material-icons">play_circle_outline</i>
            ${this.mediaFile.resolution ? html`<div class="resolution">${this.mediaFile.resolution}</div>` : ""}
            ${this.mediaFile.audio ? html`<div class="audio">${this.mediaFile.audio}</div>` : ""}
            ${this.mediaFile.quality ? html`<div class="quality">${this.mediaFile.quality}</div>` : ""}
            ${this.mediaFile.raw ? html`<div class="raw">${this.mediaFile.raw}</div>` : ""}
        </div>
        <div class="buttons">
            <div class="open-folder" tabindex="0" @click=${this.showInFolder} >
                <i class="material-icons">folder</i>
            </div>
        </div>`;
    }
}
