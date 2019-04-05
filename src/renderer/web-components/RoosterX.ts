
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./VideoCard";
import * as score from "string-score";
import {MetaData} from "../../entity/MetaData";

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public _media: MetaData[] = [];
    @property() public _filteredMedia: MetaData[] = [];
    @property() public _fullScreen: boolean = false;
    @property() public _sideBar: boolean = false;
    @property() public _searchTerm: string = "";

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getConfig().then(console.log);
        IpcService.getAllMedia().then(media => this.media = media);
        this._fullScreen = false;
        this._sideBar = false;

        document.addEventListener("click", <HTMLElement>(e) => {
            if (e && (!e.target.closest(".side-bar") && !e.target.closest(".top-bar"))) {
                if (this._sideBar) {
                    this._sideBar = false;
                    this.setFocuseToVideos();
                }
            }
        });
    }

    set media(data) {
        this._media = data;
        this._filteredMedia = [...data];
        console.log(data);
        this.requestUpdate();
    }

    private static close() {
        IpcService.quitApp();
    }

    private toggleFullScreen() {
        IpcService.fullScreen();
        this._fullScreen = !this._fullScreen;
        this.setFocuseToVideos();
    }

    private toggleSideBar() {
        this._sideBar = !this._sideBar;
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
        // todo: get filter window
    }

    private showSettings() {
        // todo: get settings window
    }

    private search(e?: any) {
        this._filteredMedia = [...this._media];
        if (e && e.target.value) {
            const searchTerm = e.target.value;
            this._filteredMedia = this._filteredMedia.filter((v) => {
                const s = score(v.title, searchTerm, 0.5);
                // console.log(v.title + " - " + searchTerm, s);
                return s > 0.5;
            });
            this._searchTerm = searchTerm;
        } else {
            this._searchTerm = "";
        }
        this.requestUpdate();
    }

    private clearSearch() {
        const input = document.querySelector(".search input") as HTMLInputElement;
        if (input) {
            input.value = "";
            this.search();
            this.setFocuseToVideos();
            this.requestUpdate();
        }
    }

    private setFocuseToVideos() {
        const videos = document.querySelector(".videos") as HTMLElement;
        if (videos) {
            videos.focus();
        }
    }

    public render() {
        return html`
        <div class="top-bar">
            <div>
                <div class="logo" @click="${this.toggleSideBar}"></div>
                <div class="search">
                    <input type="text" placeholder="Search..." @input="${this.search}">
                    ${this._searchTerm ? html`<i class="material-icons" @click=${this.clearSearch}>backspace</i>` : ""}
                </div>
                <div class="refresh"></div>
            </div>
            <div>
                <div class="user"></div>
                <div class="maximize" @click=${this.toggleFullScreen}>
                    <i class="material-icons">${this._fullScreen ? "fullscreen_exit" : "fullscreen"}</i>
                </div>
                <div class="close" @click=${RoosterX.close}>
                    <i class="material-icons">close</i>
                </div>
            </div>
        </div>
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
        ${this._sideBar ? html`<div class="panel"></div>` : ""}
        <div class="videos" tabindex="0">
            ${this._filteredMedia.map(v => html`<video-card .video=${v}></video-card>`)}
        </div>`;
    }
}
