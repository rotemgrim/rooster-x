
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MediaFile} from "../../entity/MediaFile";
import {VideoDetails} from "./VideoDetails";
import "./MediaFileCard";
import "./TorrentFileCard";
import {IEpisodeExtended} from "../../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {TorrentFile} from "../../entity/TorrentFile";

@customElement("episode-card")
export class EpisodeCard extends LitElement {

    @property() public videoDetails: VideoDetails;
    @property() public episode: IEpisodeExtended;
    @property() public isShowPlayOptions: boolean;
    @property() public isShowDownloadOptions: boolean;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.isShowPlayOptions = false;
        this.isShowDownloadOptions = false;
    }

    public playEpisode() {
        if (this.episode && this.episode.mediaFiles && this.episode.mediaFiles.length > 1) {
            // show options for select
            this.isShowPlayOptions = !this.isShowPlayOptions;
        } else if (this.episode && this.episode.mediaFiles.length === 0 && this.episode.torrentFiles.length > 0) {
            // show download options
            this.isShowDownloadOptions = !this.isShowDownloadOptions;
        } else {
            this.playFile(this.episode.mediaFiles[0]);
        }
    }

    private playFile(mFile: MediaFile) {
        this.dispatchEvent(new CustomEvent("playMedia", {detail: mFile}));
    }

    private playMediaEvent(e: CustomEvent) {
        this.playFile(e.detail);
    }

    public fileOptions(file: MediaFile) {
        return html`<media-file-card .mediaFile=${file} @playMedia=${this.playMediaEvent}></media-file-card>`;
    }

    public static torrentFileOptions(file: TorrentFile) {
        return html`<torrent-file-card .torrentFile=${file}></torrent-file-card>`;
    }

    private setWatch(e) {
        let isWatched;
        if (e.target.hasAttribute("checked")) {
            console.log("set unwatched");
            isWatched = false;
        } else {
            console.log("set watched");
            isWatched = true;
        }
        IpcService.setWatched({type: "Episode", entityId: this.episode.id, isWatched})
            .then((payload: {isSeriesWatched: boolean}) => {
                console.log("got payload", payload);
                this.episode.isWatched = isWatched;
                this.videoDetails.video.isWatched = payload.isSeriesWatched;
                this.videoDetails.requestUpdate();
                this.requestUpdate();
            })
            .catch(console.log);
    }

    private getTitle() {
        let title = "";
        if (this.episode.mediaFiles.length === 0) {
            if (this.episode.torrentFiles.length === 0) {
                title = "Missing file";
            } else if (this.episode.torrentFiles.length === 1) {
                title = "click to download " + this.episode.torrentFiles[0].raw;
            } else {
                title = "click to see " + this.episode.torrentFiles.length + " torrents";
            }
        } else if (this.episode.mediaFiles.length === 1) {
            title = this.episode.mediaFiles[0].raw;
        } else {
            title = "Click to see " + this.episode.mediaFiles.length + " files";
        }
        return title;
    }

    private getPlotTitle() {
        let title = " N/A ";
        if (this.episode.plot) {
            title = this.episode.plot;
        }
        return title;
    }

    public render() {
        return html`<div class="episode ${this.episode.isWatched ? `watched` : ``}">
            <span class="title" alt="${this.getPlotTitle()}">
                ${this.episode.season}.${this.episode.episode} - ${this.episode.title}
            </span>
            <div class="watch-btn" @click=${this.setWatch}
                    ?checked=${this.episode.isWatched}
                    title="${this.episode.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
            <div class="image" @click=${this.playEpisode} title="${this.getTitle()}">
                ${this.episode.mediaFiles.length > 0 ?
                    html`<i class="material-icons">play_circle_outline</i>` :
                    html`${this.episode.torrentFiles.length > 0 ?
                        html`<i class="material-icons">cloud_download</i>` :
                        html`<i class="material-icons">cancel</i>`}`}
                ${this.episode.poster ?
                    html`<img src="${this.episode.poster}" alt="${this.episode.title}" />` :
                    html`<div class="img-missing"><span>${this.episode.title}</span></div>`}
            </div>
            <span class="plot">${this.episode.plot}</span>
        </div>
        ${this.isShowPlayOptions ?
            html`<br>${this.episode.mediaFiles.map(f => this.fileOptions(f))}` : ""}

        ${this.isShowDownloadOptions ?
            html`<br>${this.episode.torrentFiles.map(f => EpisodeCard.torrentFileOptions(f))}` : ""}`;
    }
}
