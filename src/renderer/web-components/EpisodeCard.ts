
import {css, LitElement, html, customElement, property} from "lit-element";
import {MetaData} from "../../entity/MetaData";
import {Episode} from "../../entity/Episode";
import "./VideoDetails";
import {IpcService} from "../services/ipc.service";
import {MediaFile} from "../../entity/MediaFile";

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
            this.isShowPlayOptions = true;
        } else {
            IpcService.openExternal(this.episode.mediaFiles[0].path);
        }
    }

    public static fileOptions(file: MediaFile) {
        return html`<span>${file.raw}</span>`;
    }

    public render() {
        return html`<div @click=${this.playEpisode}
                class="episode" title="${this.episode.title}">
            <span class="title">${this.episode.season}.${this.episode.episode} - ${this.episode.title}</span>
            <div class="image">
                ${this.isShowPlayOptions ?
                    html`${this.episode.mediaFiles.map(f => EpisodeCard.fileOptions(f))}` :
                    html`<i class="material-icons">play_circle_outline</i>`}
                <img src="${this.episode.poster}" alt="${this.episode.title}">
            </div>
        </div>`;
    }
}
