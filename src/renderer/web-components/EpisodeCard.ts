
import {css, LitElement, html, customElement, property} from "lit-element";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import {IpcService} from "../services/ipc.service";
import {MediaFile} from "../../entity/MediaFile";
import "./VideoDetails";
import "./MediaFileCard";

@customElement("episode-card")
export class EpisodeCard extends LitElement {

    @property() public video: MetaData;
    @property() public episode: Episode;
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

    public render() {
        return html`<div @click=${this.playEpisode}
                class="episode" title="${this.episode.title}">
            <span class="title">${this.episode.season}.${this.episode.episode} - ${this.episode.title}</span>
            <div class="image">
                <i class="material-icons">play_circle_outline</i>
                <img src="${this.episode.poster}" alt="${this.episode.title}">
            </div>
        </div>
        ${this.isShowPlayOptions ?
            html`<br>${this.episode.mediaFiles.map(f => EpisodeCard.fileOptions(f))}` : ""}`;
    }
}
