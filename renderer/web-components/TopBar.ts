
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import score from "string-score";

@customElement("top-bar")
export class TopBar extends LitElement {

    @property() public rooster: RoosterX;
    @property() public _fullScreen: boolean = false;
    @property() public _searchTerm: string = "";
    @property() public showProfileMenu: boolean = false;
    @property() public _toggleTorrents: boolean = false;

    @property() public hours: string = "";
    @property() public minutes: string = "";
    private torrentsViewScrollPos: number = 0;
    private foldersViewScrollPos: number = 0;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public firstUpdated() {
        setInterval(() => {
            const date = new Date();
            // get hours and minutes and pad them with 0 if they are less than 10
            let hours = date.getHours();
            let minutes = date.getMinutes();
            minutes < 10 ? (this.minutes = "0" + minutes) : (this.minutes = minutes.toString());
            hours < 10 ? (this.hours = "0" + hours) : (this.hours = hours.toString());
        }, 1000);
    }

    private toggleFullScreen() {
        // IpcService.fullScreen();
        // make the div full screen
        const elem = document.querySelector("body");
        if (elem && !this._fullScreen) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
                // @ts-ignore
            } else if (elem.webkitRequestFullscreen) {
                // @ts-ignore
                elem.webkitRequestFullscreen();
                // @ts-ignore
            } else if (elem.msRequestFullscreen) {
                // @ts-ignore
                elem.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
                // @ts-ignore
            } else if (document.webkitExitFullscreen) {
                // @ts-ignore
                document.webkitExitFullscreen();
                // @ts-ignore
            } else if (document.msExitFullscreen) {
                // @ts-ignore
                document.msExitFullscreen();
            }
        }
        this._fullScreen = !this._fullScreen;
        RoosterX.setFocusToVideos();
    }

    private showFilters() {
        this.rooster.openSideBar("filters");
    }

    public showTorrents() {
        // save the current position of the scroll
        // this.foldersViewScrollPos = this.rooster.videos.scrollTop;

        this.rooster.showTorrents();
        this._toggleTorrents = true;
        this.requestUpdate();
        // this.updateComplete.then(() => {
        //     this.rooster.videos.scrollTop = this.torrentsViewScrollPos;
        // });
    }

    public showFolders() {
        this._toggleTorrents = false;
        this.rooster.showFolders();
        this.requestUpdate();
    }


    public showChannels() {
        this.rooster.showChannels();
        this.requestUpdate();
    }

    private toggleSideBar() {
        this.rooster.toggleSideBar();
    }

    private search(e?: any) {
        this.rooster._filteredMedia = [...this.rooster._media];
        if (e && e.target.value) {
            const searchTerm = e.target.value;
            this.rooster._filteredMedia = this.rooster._filteredMedia.filter((v) => {
                const s = score(v.title, searchTerm, 0.5);
                // console.log(v.title + " - " + searchTerm, s);
                v.stringScore = s;
                return s > 0.3;
            });
            this._searchTerm = searchTerm;
            this.rooster._filteredMedia.sort((a, b) => {
                if (a && b && b.stringScore && a.stringScore) {
                    return b.stringScore - a.stringScore;
                }
                return 0;
            });
        } else {
            this._searchTerm = "";
            this.rooster.refreshMedia();
        }
        this.requestUpdate();
    }

    private clearSearch() {
        const input = document.querySelector(".search input") as HTMLInputElement;
        if (input) {
            input.value = "";
            // this.search();
            this.rooster.refreshMedia();
            RoosterX.setFocusToVideos();
            // this.requestUpdate();
        }
    }

    private static close() {
        // IpcService.hideMe();
        window.open('javascript:window.open("", "_self", "");window.close();', '_self');
    }

    private logout() {
        // this.rooster.config.userId = 0;
        localStorage.removeItem("user");
        location.reload();

        // IpcService.saveConfig(this.rooster.config)
        //     .then(() => {
        //         delete this.rooster.user;
        //         this.rooster.wrapper.isLoggedIn = false;
        //     })
        //     .catch(console.log);
    }

    public render() {
        return html`
        <div class="top-bar">
            <div>
                <div class="logo" tabindex="0" @click="${this.toggleSideBar}"></div>
                <div tabindex="0" class="filter ${this.rooster.view === "folders" ? "active" : ""}" 
                     @click="${this.showFolders}">
                    <i class="material-icons">folder</i>
                </div>
                <div tabindex="0" class="filter ${this.rooster.view === "torrents" ? "active" : ""}" 
                     @click="${this.showTorrents}">
                    <i class="material-icons">cloud_download</i>
                </div>
                <div tabindex="0" class="filter ${this.rooster.view === "channels" ? "active" : ""}" 
                     @click="${this.showChannels}">
                    <i class="material-icons">live_tv</i>
                </div>
                <div tabindex="0" class="filter" @click="${this.showFilters}" style="display: block; color: white;">
                    <i class="material-icons">filter_list</i>
                </div>
                <div class="search">
                    <input type="text" placeholder="Search..." @input="${this.search}">
                    ${this._searchTerm ? html`<i class="material-icons" @click=${this.clearSearch}>backspace</i>` : ""}
                </div>
                <div class="refresh"></div>
            </div>
            <div class="clock">
                <div class="time">
                    ${this.hours}:${this.minutes}
                </div>
            </div>
            <div>
                ${this.rooster && this.rooster.user ?
                    html`<div class="user" @click=${() => this.showProfileMenu = !this.showProfileMenu}>
                        ${this.rooster.user.firstName}
                        <i class="material-icons">account_circle</i>
                        ${this.showProfileMenu ?
                            html`<ul>
                                <li @click="${this.logout}">Logout</li>
                            </ul>` : ""}
                    </div>` : ""}
                <div class="maximize" @click=${this.toggleFullScreen}>
                    <i class="material-icons">${this._fullScreen ? "fullscreen_exit" : "fullscreen"}</i>
                </div>
                <div class="close" @click=${TopBar.close}>
                    <i class="material-icons">close</i>
                </div>
            </div>
        </div>`;
    }
}
