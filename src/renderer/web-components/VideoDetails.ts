
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";
import {VideoCard} from "./VideoCard";
import "./EpisodeCard";

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

                <div class="score">
                    <span class="rating">${this.video.rating}</span>
                    <span class="votes">${this.video.votes} <small>/ votes</small></span>
                </div>
                <div class="imdb">IMDb</div>
                <div class="trailer">Trailer</div>
            </div>
            <div class="main-details">
                <h1>${this.video.name}</h1>
                <p>${this.video.plot}</p>
                <div class="small-details">
                    <br><br>
                    <p class="geners">${this.video.genres} |
                     ${VideoDetails.getRuntime(this.video)}
                     ${VideoDetails.getYear(this.video)}
                     ${this.video.languages}</p>
                </div>

                ${this.video.type === "series" && this.video.episodes
                    && this.video.episodes.length > 0 ?
                    html`<div class="episodes">
                        ${this.video.episodes.map(ep => {
                            return html`<episode-card .episode=${ep}></episode-card>`;
                        })}
                        ${this.video.episodes.map(ep => {
                            return html`<episode-card .episode=${ep}></episode-card>`;
                        })}
                        ${this.video.episodes.map(ep => {
                            return html`<episode-card .episode=${ep}></episode-card>`;
                        })}
                    </div>` : ""}
                <br><br>
                <p>Actors: <small>${this.video.actors}</small></p>
                <br><br>
                <p>Made in ${this.video.country}</p>
            </div>
        </div>`;
    }
}
