
import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {ifDefined} from "lit/directives/if-defined.js";
import {type RoosterX} from "./RoosterX";
import {type View, viewAllowed} from "../common/routes";
import {currentUser, logout} from "../common/session";

// The top bar's view buttons.
const VIEW_BUTTONS: {view: View, icon: string, title?: string}[] = [
    {view: "folders", icon: "folder"},
    {view: "torrents", icon: "cloud_download"},
    {view: "channels", icon: "live_tv"},
    {view: "lists", icon: "playlist_play"},
    {view: "downloads", icon: "downloading", title: "Downloads"},
];

@customElement("top-bar")
export class TopBar extends LitElement {

    // Absent on the login screen, where the bar is only decoration.
    @property({attribute: false}) public rooster?: RoosterX;
    // The current view and search, owned by RoosterX.
    @property({attribute: false}) public view: string = "";
    @property({attribute: false}) public searchTerm: string = "";
    @property() public _fullScreen: boolean = false;
    @property() public showProfileMenu: boolean = false;
    // Phones collapse the search box into an icon that opens it over the bar.
    @state() private searchOpen = false;

    @property() public hours: string = "";
    @property() public minutes: string = "";

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
        this.rooster?.focusLibrary();
    }

    private search(e: InputEvent) {
        this.rooster?.updateQuery({search: (e.target as HTMLInputElement).value.trim()});
    }

    private clearSearch() {
        const input = this.querySelector(".search input") as HTMLInputElement;
        if (input) {
            input.value = "";
        }
        this.rooster?.updateQuery({search: ""});
        this.rooster?.focusLibrary();
    }

    private openSearch() {
        this.searchOpen = true;
        this.updateComplete.then(() => (this.querySelector(".search input") as HTMLInputElement)?.focus());
    }

    private static close() {
        window.open('javascript:window.open("", "_self", "");window.close();', '_self');
    }

    public render() {
        // nobody on the login screen, where the bar is only decoration
        const user = currentUser();
        return html`
        <div class="top-bar ${this.searchOpen ? "search-open" : ""}">
            <div>
                <div class="logo" tabindex="0" @click=${() => this.rooster?.toggleMenu()}></div>
                ${VIEW_BUTTONS.filter(({view}) => user && viewAllowed(view, user)).map(({view, icon, title}) =>
                    html`<div tabindex="0" class="filter ${this.view === view ? "active" : ""}" title=${ifDefined(title)}
                        @click=${() => this.rooster?.navigate({view})}>
                        <i class="material-icons">${icon}</i>
                    </div>`)}
                <div tabindex="0" class="filter filters-btn" @click=${() => this.rooster?.openSidePanel("filters")}>
                    <i class="material-icons">filter_list</i>
                </div>
                <div tabindex="0" class="filter search-toggle ${this.searchTerm ? "active" : ""}" @click="${this.openSearch}">
                    <i class="material-icons">search</i>
                </div>
                <div class="search">
                    <i class="material-icons search-close" @click=${() => (this.searchOpen = false)}>arrow_back</i>
                    <input type="text" placeholder="Search..." @input="${this.search}">
                    ${this.searchTerm ? html`<i class="material-icons" @click=${this.clearSearch}>backspace</i>` : ""}
                </div>
                <div class="refresh"></div>
            </div>
            <div class="clock">
                <div class="time">
                    ${this.hours}:${this.minutes}
                </div>
            </div>
            <div>
                ${user ?
                    html`<div class="user" @click=${() => this.showProfileMenu = !this.showProfileMenu}>
                        <span class="user-name">${user.firstName}</span>
                        <i class="material-icons">account_circle</i>
                        ${this.showProfileMenu ?
                            html`<ul>
                                <li @click=${logout}>Switch user</li>
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
