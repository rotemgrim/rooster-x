
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";
import {VideoCard} from "./VideoCard";

@customElement("video-details")
export class VideoDetails extends LitElement {

    @property() public video: MetaData;
    @property() public card: VideoCard;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        setTimeout(() => {
            this.focus();
        });
    }

    public static getRuntime(vid: MetaData): string {
        let min = vid.runtime; // in minutes
        if (min === 0) {
            return "";
        }

        const hr = parseInt((min / 60).toString(), 10);
        min = min - (hr * 60);
        const hMin =  min + "min ";
        const hHour = hr + "h ";
        let humanTime = "";
        if (hr > 0) {
            humanTime += hHour;
        }
        if (min > 0) {
            humanTime += hMin;
        }
        if (humanTime) {
            humanTime += "|";
        }
        return humanTime;
    }

    public static getYear(vid: MetaData): string {
        if (vid.year) {
            return vid.year + " |";
        } else if (vid.released) {
            const tmp = (vid.released.toString()).split("-");
            if (tmp.length > 0) {
                return tmp[0] + " |";
            }
        }
        return "";
    }

    public close() {
        this.card.isShowDetails = false;
        document.body.style.overflow = "auto";
        this.requestUpdate();
    }

    public render() {
        return html`<div class="video-details">
            <div class="close" @click="${this.close}">
                X
            </div>
            <div class="poster">
                ${this.video.poster ?
                html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                html`<img src="" alt="${this.video.poster}"/>`}
            </div>
            <h1>${this.video.name}</h1>
            <p>${this.video.plot}</p>
            <div class="small-details">
                <div class="score" style="float: right;">
                    <span class="imdb">${this.video.rating} / <small>${this.video.votes}</small></span><br>
                </div>
                <br><br>
                <p class="geners">${this.video.genres} |
                 ${VideoDetails.getRuntime(this.video)}
                 ${VideoDetails.getYear(this.video)}</p>
                <p>Made in ${this.video.country}, ${this.video.languages}<br><br></p>
                <br><br>
                <p>Actors: <small>${this.video.actors}</small></p>
                ${this.video.type}<br><br>
                ${this.video.imdburl}<br><br>
                <br><br>
            </div>

            ${this.video.type === "series" && this.video.episodes
                && this.video.episodes.length > 0 ?
                html`<div class="episodes">
                    ${this.video.episodes.map(ep => {
                        return html`<div>${ep.title}<br><img src="${ep.poster}" alt=""></div><br>`;
                    })}
                </div>` : ""}
        </div>`;
    }
}
