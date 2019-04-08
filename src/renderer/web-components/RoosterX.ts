
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./TopBar";
import "./VideoCard";
import "./FiltersPage";
import "./SettingsPage";
import {MetaData} from "../../entity/MetaData";
import {IMetaDataExtended} from "../../common/models/IMetaDataExtended";
import {User} from "../../entity/User";

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public user: User;
    @property() public _media: MetaData[] = [];
    @property() public _filteredMedia: IMetaDataExtended[] = [];
    @property() public _sideBar: boolean = false;
    @property() public _panel: string = "";

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this._sideBar = false;
        this._panel = "";
        IpcService.getAllMedia().then(media => this.media = media);
        document.addEventListener("click", <HTMLElement>(e) => {
            if (e && !e.target.closest(".side-bar")
                && !e.target.closest(".top-bar")
                && !e.target.closest(".page")
            ) {
                if (this._sideBar) {
                    this._sideBar = false;
                    this.setFocuseToVideos();
                }
            }
        });
    }

    set media(data) {
        console.log(data);
        this._media = data;
        this._filteredMedia = [...data];
        for (const me of this._filteredMedia) {
            if (me.userMetaData.filter(x => x.isWatched && x.userId === this.user.id).length > 0) {
                me.isWatched = true;
            }
        }
        // console.log(data);
        console.log(this._filteredMedia);
        this.requestUpdate();
    }

    private getAllMedia() {
        this._sideBar = false;
        IpcService.getAllMedia().then(media => this.media = media);
        this.setFocuseToVideos();
    }

    private getMovies() {
        this._sideBar = false;
        IpcService.getAllMovies().then(media => this.media = media);
        this.setFocuseToVideos();
    }

    private getSeries() {
        this._sideBar = false;
        IpcService.getAllSeries().then(media => this.media = media);
        this.setFocuseToVideos();
    }

    private showFilters() {
        this._panel = "filters";
        this.requestUpdate();
    }

    private showSettings() {
        this._panel = "settings";
        this.requestUpdate();
    }

    public setFocuseToVideos() {
        const videos = document.querySelector(".videos") as HTMLElement;
        if (videos) {
            videos.focus();
        }
    }

    public render() {
        return html`
        <top-bar .rooster="${this}"></top-bar>
        <div class="side-bar ${this._sideBar ? "open" : ""}">
            <ul>
                <li @click="${this.getAllMedia}"><i class="material-icons">video_library</i>All Media</li>
                <li @click="${this.getMovies}"><i class="material-icons">movie</i>Movies</li>
                <li @click="${this.getSeries}"><i class="material-icons">live_tv</i>Series</li>
                <li @click="${this.showFilters}"><i class="material-icons">filter_list</i>Filter</li>
            </ul>
            <ul>
                <li @click="${this.showSettings}"><i class="material-icons">settings</i>Settings</li>
            </ul>
        </div>
        ${this._sideBar ? html`<div class="panel">
            ${this._panel === "filters" ? html`<filters-page .rooster="${this}"></filters-page>` : ""}
            ${this._panel === "settings" ? html`<settings-page .rooster="${this}"></settings-page>` : ""}
        </div>` : ""}
        <div class="videos" tabindex="0">
            ${this._filteredMedia.map(v => html`<video-card .video=${v}></video-card>`)}
        </div>`;
    }
}
