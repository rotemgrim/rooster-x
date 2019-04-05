
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./VideoCard";

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public _media = [];
    @property() public _fullScreen = false;
    @property() public _sideBar = false;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getConfig().then(console.log);
        IpcService.getAllMedia().then(media => this.media = media);
        this._fullScreen = false;
        this._sideBar = false;
    }

    set media(data) {
        this._media = data;
        console.log(data);
        this.requestUpdate();
    }

    private static close() {
        IpcService.quitApp();
    }

    private toggleFullScreen() {
        IpcService.fullScreen();
        this._fullScreen = !this._fullScreen;
    }

    private toggleSideBar() {
        this._sideBar = !this._sideBar;
    }

    public render() {
        return html`<div class="top-bar">
            <div class="logo" @click="${this.toggleSideBar}"></div>
            <div class="search"></div>
            <div class="refresh"></div>
            <div class="user"></div>
            <div class="maximize" @click=${this.toggleFullScreen}>
                <i class="material-icons">${this._fullScreen ? "fullscreen_exit" : "fullscreen"}</i>
            </div>
            <div class="close" @click=${RoosterX.close}>
                <i class="material-icons">close</i>
            </div>
        </div>
        <div class="side-bar ${this._sideBar ? "open" : ""}">
            <ul>
                <li><i class="material-icons">video_library</i>All Media</li>
                <li><i class="material-icons">movie</i>Movies</li>
                <li><i class="material-icons">live_tv</i>Series</li>
                <li><i class="material-icons">filter_list</i>Filter</li>
            </ul>
        </div>
        <div class="videos">
            ${this._media.map(v => html`<video-card .video=${v}></video-card>`)}
        </div>`;
    }
}
