
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";

@customElement("video-card")
export class VideoCard extends LitElement {

    @property() public video: MetaData;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public render() {
        return html`<div class="video">
            ${this.video.poster ?
                html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                html`<img src="" alt="${this.video.poster}"/>`}
        </div>`;
    }
}
