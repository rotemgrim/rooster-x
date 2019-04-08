
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";
import {VideoCard} from "./VideoCard";
import "./EpisodeCard";
import "./MediaFileCard";
import {IMetaDataExtended} from "../../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";

@customElement("video-details")
export class VideoDetails extends LitElement {

    @property() public video: IMetaDataExtended;
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
        if (min === 0 || !min) {
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
        RoosterX.setFocusToVideos();
        this.requestUpdate();
    }

    protected firstUpdated(): void {
        if (this.video.type === "series") {
            IpcService.dbQuery("Episode", {
                where: {
                    imdbSeriesId: this.video.imdbId,
                },
                order: {
                    season: "ASC",
                    episode: "ASC",
                },
                cache: true,
            }).then(res => {
                console.log(res);
                this.video.episodes = res;
                this.requestUpdate();
            }).catch(console.log);
        }
    }

    private setWatched() {
        IpcService.setWatched({type: "MetaData", entityId: this.video.id});
    }

    public render() {
        return html`<div class="video-details">
            <div class="close" @click="${this.close}">
                X
            </div>
            <div class="aside">
                <div class="poster ${this.video.isWatched ? "watched" : ""}">
                <div class="filter"></div>
                    ${this.video.poster ?
                html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                html`<img src="" alt="${this.video.poster}"/>`}
                </div>
                <div class="score">
                    <span class="rating">${this.video.rating}</span>
                    <span class="votes">${this.video.votes} <small>/ votes</small></span>
                </div>
                <div class="imdb">IMDb</div>
                <div class="trailer">Trailer</div>
                <div class="trailer" @click=${this.setWatched}>Watched</div>
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
                    </div>` : ""}

                ${this.video.type === "movie" && this.video.mediaFiles
                    && this.video.mediaFiles.length > 0 ?
                    html`<div class="media-files">
                        ${this.video.mediaFiles.map(mf => {
                            return html`<media-file-card .mediaFile=${mf}></media-file-card>`;
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
