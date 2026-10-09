import {LitElement, html, nothing} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {classMap} from "lit/directives/class-map.js";
import "./AddToList";
import {IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {type RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import {modal} from "./dialog";

// How long a finger has to rest on a poster to open its actions.
const LONG_PRESS_MS = 500;

/** A library poster. Opening its details is a navigation; RoosterX shows them. */
@customElement("video-card")
export class VideoCard extends LitElement {

    @property({attribute: false}) public rooster: RoosterX;
    @property({attribute: false}) public video: IMetaDataExtended;
    @property({type: Boolean}) public showDebug: boolean = false;

    @state() private showActions = false;
    @state() private showAddToList = false;
    private pressTimer: number | undefined;
    // set when a long press opened the actions, so the tap that ends it doesn't also open the details
    private longPressed = false;

    public createRenderRoot() {
        return this;
    }

    private onPosterClick() {
        if (this.longPressed) {
            this.longPressed = false;
            return;
        }
        this.rooster.openCard(this.video);
    }

    // passive, so holding a poster never delays scrolling
    private touchStart = {
        passive: true,
        handleEvent: () => {
            this.longPressed = false;
            window.clearTimeout(this.pressTimer);
            this.pressTimer = window.setTimeout(() => {
                this.longPressed = true;
                this.showActions = true;
            }, LONG_PRESS_MS);
        },
    };

    private cancelPress = {
        passive: true,
        handleEvent: () => window.clearTimeout(this.pressTimer),
    };

    // Right click, or a long press on browsers that report it as a context menu.
    private onContextMenu(e: MouseEvent) {
        e.preventDefault();
        window.clearTimeout(this.pressTimer);
        this.showActions = true;
    }

    private toggleWatched() {
        const isWatched = !this.video.isWatched;
        this.showActions = false;
        IpcService.setWatched({type: "MetaData", entityId: this.video.id, isWatched})
            .then(() => {
                this.rooster.setItemWatched(this.video, isWatched);
                this.requestUpdate();
            })
            .catch(console.log);
    }

    private renderActions() {
        if (this.showAddToList) {
            return html`<add-to-list
                .rooster=${this.rooster}
                .metaDataId=${this.video.id}
                .onClose=${() => (this.showAddToList = false)}></add-to-list>`;
        }
        if (!this.showActions) {
            return nothing;
        }
        const watched = !!this.video.isWatched;
        return modal(() => (this.showActions = false), html`<div class="modal action-sheet" role="dialog" aria-modal="true">
            <h3>${this.video.title}</h3>
            <button @click=${() => {
                this.showActions = false;
                this.rooster.openCard(this.video);
            }}><i class="material-icons">info</i>Details</button>
            <button @click=${this.toggleWatched}>
                <i class="material-icons">${watched ? "visibility_off" : "visibility"}</i>${watched ? "Mark as unwatched" : "Mark as watched"}
            </button>
            <button @click=${() => {
                this.showActions = false;
                this.showAddToList = true;
            }}><i class="material-icons">playlist_add</i>Add to list</button>
        </div>`);
    }

    public render() {
        return html`<div class="video" tabindex="0"
            @click=${this.onPosterClick}
            @contextmenu=${this.onContextMenu}
            @touchstart=${this.touchStart}
            @touchmove=${this.cancelPress}
            @touchend=${this.cancelPress}
            @touchcancel=${this.cancelPress}>
            <div class="${classMap({
            "poster": true,
                "watched": !!this.video.isWatched,
                "k4": !!this.video.resolution?.includes("2160"),
            })}" ${this.video.isWatched ? "watched" : ""}">
                <div class="filter"></div>
                <div class="watch-btn" tabindex="-1" title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                ${this.showDebug ? html`
                    <div style="position:absolute;top:4px;left:4px;z-index:5;background:rgba(0,0,0,0.7);color:#fff;font:600 11px/1.2 monospace;padding:3px 5px;border-radius:3px;pointer-events:none;text-shadow:0 1px 1px rgba(0,0,0,0.8);">
                        <div>t: ${this.video.trendingCount ?? 0}</div>
                        <div>u: ${this.video.uploadedAt ?? this.video.uploadedDate ?? "-"}</div>
                    </div>
                ` : ""}
                ${this.video.poster ?
                    html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                    html`<div class="img-missing"><span>${this.video.title}</span></div>`}
            </div>
        </div>
        ${this.renderActions()}`;
    }
}
