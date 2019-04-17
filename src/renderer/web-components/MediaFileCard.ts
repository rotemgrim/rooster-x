
import {LitElement, html, customElement, property} from "lit-element";
import {MediaFile} from "../../entity/MediaFile";
import {RoosterX} from "./RoosterX";

@customElement("media-file-card")
export class EpisodeCard extends LitElement {

    @property() public mediaFile: MediaFile;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public playFile() {
        RoosterX.playMediaFile(this.mediaFile);
    }

    public static fileOptions(file: MediaFile) {
        return html`<span>${file.raw}</span>`;
    }

    public render() {
        return html`<div @click=${this.playFile} class="media-file" title="${this.mediaFile.raw}">
            <i class="material-icons">play_circle_outline</i>
            ${this.mediaFile.resolution ? html`<div class="resolution">${this.mediaFile.resolution}</div>` : ""}
            ${this.mediaFile.audio ? html`<div class="audio">${this.mediaFile.audio}</div>` : ""}
            ${this.mediaFile.quality ? html`<div class="quality">${this.mediaFile.quality}</div>` : ""}
            ${this.mediaFile.raw ? html`<div class="raw">${this.mediaFile.raw}</div>` : ""}
        </div>`;
    }
}
