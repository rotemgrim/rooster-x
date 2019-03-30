
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";
import "./VideoDetails";

@customElement("video-card")
export class VideoCard extends LitElement {

    @property() public video: MetaData;
    @property() public isShowDetails: boolean;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.isShowDetails = false;
    }

    public showDetails() {
        this.isShowDetails = true;
        document.body.style.overflow = "hidden";
        this.requestUpdate();
    }

    public render() {
        return html`<div class="video" @click="${this.showDetails}">
            ${this.video.poster ?
                html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                html`<img src="" alt="${this.video.poster}"/>`}
        </div>
        ${this.isShowDetails ?
            html`<video-details tabindex="${this.video.id}"
                    .card="${this}"
                    .video=${this.video}>
                </video-details>` : ""}`;
    }
}
