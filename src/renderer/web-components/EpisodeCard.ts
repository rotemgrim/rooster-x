
import {css, LitElement, html, customElement, property} from "lit-element";
import {MetaData} from "../../entity/MetaData";
import "./VideoDetails";
import {Episode} from "imdb-api";

@customElement("episode-card")
export class EpisodeCard extends LitElement {

    @property() public video: MetaData;
    @property() public episode: Episode;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public render() {
        return html`<div class="episode" title="${this.episode.title}">
            <span class="title">${this.episode.season}.${this.episode.episode} - ${this.episode.title}</span>
            <div class="image">
                <i class="material-icons">play_circle_outline</i>
                 <img src="${this.episode.poster}" alt="${this.episode.title}">
            </div>
        </div>`;
    }
}
