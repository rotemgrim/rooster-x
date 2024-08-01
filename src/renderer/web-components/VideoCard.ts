
import {LitElement, html, customElement, property} from "lit-element";
import "./VideoDetails";
import {IMetaDataExtended} from "../../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";

@customElement("video-card")
export class VideoCard extends LitElement {

    @property() public rooster: RoosterX;
    @property() public video: IMetaDataExtended;
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
        return html`<div class="video" @click="${this.showDetails}" >
            <div class="poster ${this.video.isWatched ? "watched" : ""}">
                <div class="filter"></div>
                <div class="watch-btn" title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                ${this.video.poster ?
                    html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                    html`<div class="img-missing"><span>${this.video.title}</span></div>`}
            </div>
        </div>
        ${this.isShowDetails ?
            html`<video-details tabindex="${this.video.id}"
                    .rooster=${this.rooster}
                    .card=${this}
                    .video=${this.video}>
                </video-details>` : ""}`;
    }
}
