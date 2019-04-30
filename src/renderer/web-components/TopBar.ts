
import {css, LitElement, html, customElement, property} from "lit-element";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import * as score from "string-score";

@customElement("top-bar")
export class TopBar extends LitElement {

    @property() public rooster: RoosterX;
    @property() public _fullScreen: boolean = false;
    @property() public _searchTerm: string = "";
    @property() public showProfileMenu: boolean = false;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    private toggleFullScreen() {
        IpcService.fullScreen();
        this._fullScreen = !this._fullScreen;
        RoosterX.setFocusToVideos();
    }

    private showFilters() {
        this.rooster.openSideBar("filters");
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
        }
        this.requestUpdate();
    }

    private clearSearch() {
        const input = document.querySelector(".search input") as HTMLInputElement;
        if (input) {
            input.value = "";
            this.search();
            RoosterX.setFocusToVideos();
            this.requestUpdate();
        }
    }

    private static close() {
        IpcService.hideMe();
    }

    private logout() {
        this.rooster.config.userId = 0;
        IpcService.saveConfig(this.rooster.config)
            .then(() => {
                delete this.rooster.user;
                this.rooster.wrapper.isLoggedIn = false;
            })
            .catch(console.log);
    }

    public render() {
        return html`
        <div class="top-bar">
            <div>
                <div class="logo" @click="${this.toggleSideBar}"></div>
                <div class="filter" @click="${this.showFilters}" style="display: block; color: white;">
                    <i class="material-icons">filter_list</i>
                </div>
                <div class="search">
                    <input type="text" placeholder="Search..." @input="${this.search}">
                    ${this._searchTerm ? html`<i class="material-icons" @click=${this.clearSearch}>backspace</i>` : ""}
                </div>
                <div class="refresh"></div>
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
