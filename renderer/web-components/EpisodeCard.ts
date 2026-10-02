import {LitElement, html, PropertyValues} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {type MediaFile} from "../entity/MediaFile";
import {VideoDetails} from "./VideoDetails";
import "./MediaFileCard";
import "./TorrentFileCard";
import {IEpisodeExtended} from "../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {type TorrentFile} from "../entity/TorrentFile";

@customElement("episode-card")
export class EpisodeCard extends LitElement {
    @property() public videoDetails: VideoDetails;
    @property() public episode: IEpisodeExtended;
    @property() public isShowPlayOptions: boolean;
    @property() public isShowDownloadOptions: boolean;
    // MPV watch progress for this episode. Supplied by the parent
    // <video-details> via a single bulk fetch (see VideoDetails
    // .startEpisodesWatchProgressPoll) instead of one request per card.
    @property() public watchProgress: null | {
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
    } = null;
    // The plot is clamped to a few lines on phones; tapping it shows all of it.
    @state() private plotOpen = false;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.isShowPlayOptions = false;
        this.isShowDownloadOptions = false;
    }


    private renderWatchProgress() {
        // Manual "watched" flag wins → green 100%.
        if (this.episode?.isWatched) {
            return html`<div class="ep-progress">
                <div class="ep-progress-bar finished" style="width: 100%"></div>
            </div>`;
        }
        const wp = this.watchProgress;
        if (!wp || !wp.percent || wp.percent <= 0) return html``;
        const pct = Math.min(100, Math.round(wp.percent));
        const finished = !!wp.finished;
        return html`<div class="ep-progress" title="${pct}%">
            <div class="ep-progress-bar ${finished ? 'finished' : ''}" style="width: ${pct}%"></div>
        </div>`;
    }

    public playEpisode() {
        if (this.episode && this.episode.mediaFiles && this.episode.mediaFiles.length > 1) {
            // show options for select
            this.isShowPlayOptions = !this.isShowPlayOptions;
        } else if (
            this.episode &&
            (!this.episode.mediaFiles || this.episode.mediaFiles?.length === 0) &&
            this.episode.torrentFiles?.length > 0
        ) {
            // show download options
            this.isShowDownloadOptions = !this.isShowDownloadOptions;
        } else {
            this.playFile(this.episode.mediaFiles[0]);
        }
    }

    private toggleTorrents(e: Event) {
        e.stopPropagation();
        this.isShowDownloadOptions = !this.isShowDownloadOptions;
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
        // the button sits on the thumbnail, which plays the episode
        e.stopPropagation();
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
        if (this.episode?.mediaFiles?.length === 0) {
            if (this.episode.torrentFiles.length === 0) {
                title = "Missing file";
            } else if (this.episode.torrentFiles.length === 1) {
                title = "click to download " + this.episode.torrentFiles[0].raw;
            } else {
                title = "click to see " + this.episode.torrentFiles.length + " torrents";
            }
        } else if (this.episode.mediaFiles?.length === 1) {
            title = this.episode.mediaFiles[0].raw;
        } else {
            title = "Click to see " + this.episode.mediaFiles?.length + " files";
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
                    S${this.episode.season!.toString().padStart(2, "0")}-E${this.episode.episode
                        .toString()
                        .padStart(2, "0")}
                    - ${this.episode.title}
                </span>
                ${this.episode.mediaFiles?.length > 0 && this.episode.torrentFiles?.length > 0
                    ? html`<div class="ep-torrents-btn ${this.isShowDownloadOptions ? "open" : ""}"
                          title="${this.isShowDownloadOptions ? "Hide" : "Show"} ${this.episode.torrentFiles.length} torrents"
                          @click=${this.toggleTorrents}>
                          <i class="material-icons">cloud_download</i>${this.episode.torrentFiles.length}
                      </div>`
                    : ""}
                <div class="image" tabindex="0" @click=${this.playEpisode} title="${this.getTitle()}">
                    ${this.episode.mediaFiles?.length > 0
                        ? html`<i class="material-icons">play_circle_outline</i>`
                        : html`${this.episode.torrentFiles?.length > 0
                              ? html`<i class="material-icons">cloud_download</i>`
                              : html`<i class="material-icons">cancel</i>`}`}
                    ${this.episode.poster
                        ? html`<img
                              src="https://image.tmdb.org/t/p/w300${this.episode.poster}"
                              alt="${this.episode.title}" />`
                        : html`<div class="img-missing"><span>${this.episode.title}</span></div>`}
                    ${this.renderWatchProgress()}
                    <div
                        class="watch-btn"
                        @click=${this.setWatch}
                        ?checked=${this.episode.isWatched}
                        title="${this.episode.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                </div>
                <span class="plot ${this.plotOpen ? "open" : ""}" @click=${() => (this.plotOpen = !this.plotOpen)}>${this.episode.plot}</span>
            </div>
            ${this.isShowPlayOptions ? html`<br />${this.episode.mediaFiles.map(f => this.fileOptions(f))}` : ""}
            ${this.isShowDownloadOptions
                ? html`<br />${this.episode.torrentFiles.map(f => EpisodeCard.torrentFileOptions(f))}`
                : ""}`;
    }
}
