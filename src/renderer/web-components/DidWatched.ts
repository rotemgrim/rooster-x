
import {LitElement, html, customElement, property} from "lit-element";
import {MediaFile} from "../../entity/MediaFile";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import {VideoDetails} from "./VideoDetails";

@customElement("did-watched")
export class DidWatched extends LitElement {

    @property() public rooster: RoosterX;
    @property() public videoDetails: VideoDetails;
    @property() public mediaFile: MediaFile;
    @property() public didYouWatched: null | MetaData | Episode = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public setDidWatchedYes() {
        const e: any = this.didYouWatched;
        let type = "MetaData";
        if (e && e.imdbSeriesId) {
            type = "Episode";
        }

        IpcService.setWatched({type, entityId: e.id, isWatched: true})
            .then((payload: {isSeriesWatched: boolean}) => {
                if (type === "Episode") {
                    console.log("got payload", payload);
                    if (this.videoDetails.video.episodes && this.videoDetails.video.episodes.length > 0) {
                        for (const ep of this.videoDetails._episodes) {
                            if (ep.id === e.id) {
                                ep.isWatched = true;
                                this.videoDetails.reloadVideo();
                            }
                        }
                    }

                    if (payload.isSeriesWatched) {
                        this.videoDetails.video.isWatched = payload.isSeriesWatched;
                    }
                } else {
                    this.videoDetails.video.isWatched = true;
                }
                this.closeDidYouWatched();
            })
            .catch((err) => {
                console.log("could not set watched", err);
                this.closeDidYouWatched();
            });
    }

    public closeDidYouWatched() {
        this.didYouWatched = null;
        this.videoDetails.didYouWatched = null;
        this.videoDetails.requestUpdate();
        this.requestUpdate();
    }

    private getData(u: any): {poster: string, title: string, titleHtml: any, plot: string} {
        const data: {
            poster: string,
            title: string,
            titleHtml: any,
            plot: string,
        } = {
            poster: "",
            title: "",
            titleHtml: null,
            plot: "",
        };
        if (u && (u as Episode).imdbSeriesId !== undefined) {
            // this is episode
            const e: Episode = u;
            const epiNumber = "S" + ("0" + e.season).slice(-2) + "-E" + ("0" + e.episode).slice(-2);
            data.poster = e.poster || e.metaData.poster || "";
            data.title = e.metaData.title + " | " + epiNumber;
            data.titleHtml = html`<h1>${e.metaData.name || e.metaData.title}
                <br>${epiNumber}${e.title ? " | " + e.title : ""}</h1>`;
            data.plot = e.plot || "";
        } else if (u && (u as MetaData).name !== undefined) {
            // this is metaData
            const e: MetaData = u;
            data.poster = e.poster || "";
            data.title = e.name || e.title;
            data.titleHtml = html`<h1>${data.title}</h1>`;
            data.plot = e.plot || "";
        }
        return data;
    }

    private isAlreadyWatched(e: any): boolean {
        if (e && e.userEpisode && e.userEpisode.length > 0) {
            if (e.userEpisode.filter(x => x.isWatched && x.userId === this.rooster.user.id).length > 0) {
                return true;
            }
        } else if (e && e.userMetaData && e.userMetaData.length > 0) {
            if (e.userMetaData.filter(x => x.isWatched && x.userId === this.rooster.user.id).length > 0) {
                return true;
            }
        }
        return false;
    }

    public render() {
        if (this.isAlreadyWatched(this.didYouWatched)) {
            return html``;
        }

        const data = this.getData(this.didYouWatched);
        if (!data.title) {
            return html``;
        }

        return html`<div class="did-you-watched">
            ${data.poster ?
                html`<img src="${data.poster}" alt="${data.title}" />` :
                html`<div class="img-missing"><span>${data.title}</span></div>`}
            <div class="main">
                <h2>Mark as watched?</h2>
                ${data.titleHtml}
                <div class="confirm">
                    <button @click=${this.setDidWatchedYes} class="yes">Yes</button>
                    <button @click=${this.closeDidYouWatched} class="no">No</button>
                </div>
                <p>${data.plot}</p>
            </div>
        </div>`;
    }
}
