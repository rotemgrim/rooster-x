
import {LitElement, html, customElement, property} from "lit-element";
import {MetaData} from "../../entity/MetaData";
import {IpcService} from "../services/ipc.service";
import {MediaFile} from "../../entity/MediaFile";
import "./VideoDetails";
import "./MediaFileCard";
import {IEpisodeExtended} from "../../common/models/IMetaDataExtended";

@customElement("episode-card")
export class EpisodeCard extends LitElement {

    @property() public video: MetaData;
    @property() public episode: IEpisodeExtended;
    @property() public isShowPlayOptions: boolean;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.isShowPlayOptions = false;
    }

    public playEpisode() {
        if (this.episode && this.episode.mediaFiles && this.episode.mediaFiles.length > 1) {
            // show options for select
            this.isShowPlayOptions = !this.isShowPlayOptions;
        } else {
            IpcService.openExternal(this.episode.mediaFiles[0].path);
        }
    }

    public static fileOptions(file: MediaFile) {
        return html`<media-file-card .mediaFile=${file}></media-file-card>`;
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
            .then(() => {
                this.episode.isWatched = isWatched;
                this.requestUpdate();
            })
            .catch(console.log);
    }

    public render() {
        return html`<div class="episode ${this.episode.isWatched ? `watched` : ``}"
                title="${this.episode.title}">
            <span class="title">${this.episode.season}.${this.episode.episode} - ${this.episode.title}</span>
            <div class="watch-btn" @click=${this.setWatch}
                    ?checked=${this.episode.isWatched}
                    title="${this.episode.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
            <div class="image" @click=${this.playEpisode}>
                <i class="material-icons">play_circle_outline</i>
                ${this.episode.poster ?
                    html`<img src="${this.episode.poster}" alt="${this.episode.title}" />` :
                    html`<div class="img-missing"><span>${this.episode.title}</span></div>`}
            </div>
        </div>
        ${this.isShowPlayOptions ?
            html`<br>${this.episode.mediaFiles.map(f => EpisodeCard.fileOptions(f))}` : ""}`;
    }
}
