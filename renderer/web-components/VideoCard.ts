import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import "./VideoDetails";
import {IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";

@customElement("video-card")
export class VideoCard extends LitElement {

    @property() public rooster: RoosterX;
    @property() public video: IMetaDataExtended;
    @property({type: Boolean}) public showDebug: boolean = false;

    @property({attribute: "show-details", reflect: true})
    public isShowDetails: boolean;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.isShowDetails = false;
    }

    public showDetails(useHistory = false) {
        if (useHistory) {
            history.pushState({id: this.video.id}, this.video.title, `/${this.video.type}/${this.video.id}`);
        }
        console.log("showDetails", this.video.id);
        // window.addEventListener('popstate', this.closeDetails.bind(this), {once: true});
        this.toggleViewTransition(true);
        document.body.classList.add("no-scroll");
        document.startViewTransition(() => {
            this.toggleViewTransition(false);
            this.isShowDetails = true;
        });
    }

    public closeDetails(skipHistory = false) {
        if (!skipHistory) {
            history.pushState({}, "", "/");
        }
        document.body.classList.remove("no-scroll");
        RoosterX.setFocusToVideos();
        document.startViewTransition(() => {
            this.isShowDetails = false;
            this.toggleViewTransition(true);
            setTimeout(() => {
                this.toggleViewTransition(false);
                // this.rooster.refreshMedia();
            })
        });
    }

    private toggleViewTransition(state: boolean) {
        const img = this.querySelector(".poster img");
        if (state) {
            img.classList.add("video-poster-card-trans");
        } else {
            img.classList.remove("video-poster-card-trans");
        }
    }

    public render() {
        return html`<div class="video" tabindex="0" @click="${this.showDetails}">
            <div class="${classMap({
            "poster": true,
                "watched": !!this.video.isWatched,
                // @ts-ignore
                "k4": this.video.resolution.includes("2160"),
            })}" ${this.video.isWatched ? "watched" : ""}">
                <div class="filter"></div>
                <div class="watch-btn" tabindex="-1" title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                ${this.showDebug ? html`
                    <div style="position:absolute;top:4px;left:4px;z-index:5;background:rgba(0,0,0,0.7);color:#fff;font:600 11px/1.2 monospace;padding:3px 5px;border-radius:3px;pointer-events:none;text-shadow:0 1px 1px rgba(0,0,0,0.8);">
                        <div>t: ${this.video.trendingCount ?? 0}</div>
                        <div>u: ${(this.video as any).uploadedAt ?? (this.video as any).uploadedDate ?? "-"}</div>
                    </div>
                ` : ""}
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
