import {LitElement, html, PropertyValues} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import {keyed} from "lit/directives/keyed.js";
import {IpcService, promiseIpc} from "../services/ipc.service";
import "./TopBar";
import "./LibraryGrid";
import "./FiltersPage";
import "./SettingsPage";
import "./Channels";
import "./Lists";
import "./ListDetail";
import "./DownloadsPage";
import "./VideoDetails";
import {type User} from "../entity/User";
import {type IFeedItem} from "../common/models/IFeedItem";
import {type IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {type LibraryGrid} from "./LibraryGrid";
import {applyCardLayout} from "../common/layout";
import {
    arrangeLibrary,
    DEFAULT_FILTERS,
    DEFAULT_ORDER,
    type Library,
    type LibraryQuery,
    loadPrefs,
    type MediaType,
    posterUrl,
    sameGenres,
    savePrefs,
} from "../common/library";
import {isView, PAGE_VIEWS, parseRoute, type Route, routePath, type View} from "../common/routes";

// The data view each server "reload" message refreshes. These are commands,
// so they are not shown in the status bar.
const RELOAD_MESSAGES: Record<string, View> = {"reload": "folders", "reload-torrents": "torrents"};
const LAST_VIEW_KEY = "roosterx-last-view";

/** What the side bar shows: its menu, or one of the panels next to it. */
type SidePanel = "menu" | "filters" | "settings";

@customElement("rooster-x")
export class RoosterX extends LitElement {
    @property({attribute: false}) public user: User;
    @query("library-grid") private grid?: LibraryGrid;
    // Where the app is: the view, the list shown, the card whose details are open.
    @state() private route: Route;
    @state() private sidePanel: SidePanel | null = null;
    @state() private isLoading: boolean = false;
    @state() private sweepStatus: string = "";
    private sweepStatusTimer: number;

    // The current data view's rows, as streamed from the server.
    @state() private items: IFeedItem[] = [];
    // What the library shows; change it only through updateQuery(). Its
    // isTorrents says which library it belongs to, which stays meaningful
    // while a page view (channels, lists...) is shown.
    @state() private query: LibraryQuery = {
        isTorrents: false,
        mediaType: "all",
        search: "",
        filters: DEFAULT_FILTERS,
        order: DEFAULT_ORDER,
    };
    // The grid's cards: query applied to items, rebuilt whenever either changes.
    private library: Library = [];
    // The item whose details are open, from the route; rebuilt with it.
    private openItem: IMetaDataExtended | null = null;
    // The item the last openCard() was given, used while its full record loads.
    private cardSeed?: IMetaDataExtended;

    // Scroll position of each data view, restored when it is shown again.
    private scrollPositions = new Map<View, number>();

    // Streaming support: monotonically increasing stream id used to ignore
    // a superseded request (e.g. user changes view/filter mid-stream).
    private currentStreamId: number = 0;

    private unsubscribeMessages?: () => void;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        // The URL is the source of truth; a bare "/" opens the last view.
        const route = parseRoute(location.pathname);
        if (route) {
            this.route = route;
        } else {
            this.route = {view: RoosterX.lastView() || "folders"};
            history.replaceState(this.route, "", routePath(this.route));
        }
        RoosterX.saveLastView(this.route.view);
    }

    private get view(): View {
        return this.route.view;
    }

    connectedCallback() {
        super.connectedCallback();
        applyCardLayout();
        window.addEventListener("resize", this.onResize);
        window.addEventListener("popstate", this.onPopState);
        document.addEventListener("click", this.onDocumentClick);
        this.unsubscribeMessages = promiseIpc.onMessage(msg => this.showServerMessage(msg));
        if (!PAGE_VIEWS.has(this.view)) {
            this.loadLibrary(this.view === "torrents", () => this.revealDeepLinkedCard());
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("resize", this.onResize);
        window.removeEventListener("popstate", this.onPopState);
        document.removeEventListener("click", this.onDocumentClick);
        this.unsubscribeMessages?.();
    }

    protected willUpdate(changed: PropertyValues) {
        if (changed.has("items") || changed.has("query")) {
            this.library = arrangeLibrary(this.items, this.query);
        }
        if (changed.has("items") || changed.has("route")) {
            this.openItem = this.resolveOpenItem();
        }
    }

    protected updated() {
        // the details overlay covers the page, which must not scroll under it
        document.body.classList.toggle("no-scroll", !!this.openItem);
    }

    // ---- Navigation ------------------------------------------------------

    /** The one way to move around the app: records the route in history and shows it. */
    public navigate(route: Route, cardSeed?: IMetaDataExtended) {
        history.pushState(route, "", routePath(route));
        this.applyRoute(route, cardSeed);
    }

    /** Opens an item's details on top of the current view. */
    public openCard(item: IMetaDataExtended) {
        this.navigate({...this.route, card: {type: item.type, id: item.id}}, item);
    }

    public closeCard() {
        this.navigate({...this.route, card: undefined});
    }

    private onPopState = () => {
        const route = parseRoute(location.pathname);
        if (route) {
            this.applyRoute(route);
        }
    };

    private applyRoute(route: Route, cardSeed?: IMetaDataExtended) {
        const before = this.route;
        this.cardSeed = cardSeed;
        if (route.view !== before.view) {
            this.route = route;
            this.switchView(before.view);
        } else {
            this.animateCard(before.card?.id, route.card?.id, () => this.route = route);
        }
    }

    private switchView(from: View) {
        if (!PAGE_VIEWS.has(from)) {
            this.scrollPositions.set(from, this.grid?.scrollPosition || 0);
        }
        const view = this.view;
        RoosterX.saveLastView(view);
        this.closeSidePanel();
        if (PAGE_VIEWS.has(view)) {
            return;
        }
        this.loadLibrary(view === "torrents", async () => {
            await this.updateComplete;
            this.focusLibrary();
            // a card in the URL decides where the grid is; otherwise go back to where it was left
            if (this.route.card) {
                await this.revealDeepLinkedCard();
            } else {
                await this.scrollGridTo(this.scrollPositions.get(view) || 0, "smooth");
            }
        });
    }

    /**
     * Runs a route change that opens or closes a grid card's details as a view
     * transition, so the card's poster morphs into the details' poster (it
     * carries the same view-transition-name) and back.
     */
    private animateCard(fromId: number | undefined, toId: number | undefined, apply: () => void) {
        const grid = this.grid;
        if (fromId === toId || !grid || !document.startViewTransition) {
            apply();
            return;
        }
        let transition: ViewTransition;
        if (toId) {
            grid.markPoster(toId, true);
            transition = document.startViewTransition(async () => {
                grid.markPoster(toId, false);
                apply();
                await this.updateComplete;
            });
        } else {
            transition = document.startViewTransition(async () => {
                apply();
                await this.updateComplete;
                grid.markPoster(fromId!, true);
            });
            transition.finished.finally(() => grid.markPoster(fromId!, false));
            this.focusLibrary();
        }
        // a skipped transition (e.g. in a hidden tab) rejects `ready`; the update still runs
        transition.ready.catch(() => {});
    }

    /** The open card's item: the one it was opened with, the grid's row, or just its id for a list. */
    private resolveOpenItem(): IMetaDataExtended | null {
        const card = this.route.card;
        if (!card) {
            return null;
        }
        if (this.cardSeed?.id === card.id) {
            return this.cardSeed;
        }
        if (PAGE_VIEWS.has(this.view)) {
            // the details panel fetches the rest by id
            return {id: card.id, title: "", type: card.type};
        }
        return this.items.find(item => item.id === card.id) ?? null;
    }

    /** After a library loads: scroll to the URL's card, or drop the card from the URL if the library hasn't got it. */
    private async revealDeepLinkedCard() {
        const id = this.route.card?.id;
        if (!id) {
            return;
        }
        if (this.items.some(item => item.id === id)) {
            // once the grid has the new rows
            await this.updateComplete;
            await this.grid?.updateComplete;
            this.grid?.scrollToItem(id);
        } else {
            console.warn("Deep link: id not found in current view, dropping id from URL:", id);
            this.route = {view: this.view};
            history.replaceState(this.route, "", routePath(this.route));
        }
    }

    private static lastView(): View | null {
        try {
            const v = localStorage.getItem(LAST_VIEW_KEY);
            if (isView(v)) return v;
        } catch (_) {}
        return null;
    }

    private static saveLastView(view: View) {
        try {
            localStorage.setItem(LAST_VIEW_KEY, view);
        } catch (_) {}
    }

    // ---- Library ---------------------------------------------------------

    /**
     * The one way to change what the library shows. Saves filters/order, and
     * refetches only when the server-side part (the genres) changed; every
     * other change is applied to the rows already loaded.
     */
    public updateQuery(patch: Partial<Omit<LibraryQuery, "isTorrents">>) {
        const before = this.query;
        this.query = {...before, ...patch};
        if (patch.filters || patch.order) {
            savePrefs(this.query, this.user.id);
        }
        if (!sameGenres(before.filters.noMediaWithoutGenres, this.query.filters.noMediaWithoutGenres)) {
            this.reloadInPlace();
        }
    }

    /**
     * Records a title's watched state after the server accepted it. Rows are
     * shared with the cards and the details panel, so the row is updated in
     * place, and the library is re-arranged around it (unwatched-only and
     * unwatched-first depend on it).
     */
    public setItemWatched(item: IMetaDataExtended, watched: boolean) {
        item.isWatched = watched;
        this.items = [...this.items];
    }

    /** Points the query at the folders or torrents library, with its saved prefs, and streams it. */
    private loadLibrary(isTorrents: boolean, onComplete: () => void) {
        this.query = {...this.query, isTorrents, ...loadPrefs(isTorrents, this.user.id)};
        this.streamMedia(onComplete);
    }

    /**
     * Streams the current library's rows over IPC.
     *
     * Refresh policy: do NOTHING during the stream - just accumulate. The
     * loading spinner stays up until the very last chunk arrives, then the
     * rows are set at once and arranged in a single pass. This avoids the
     * "live sorting" card-shuffle effect that happens when intermediate
     * datasets are sorted/rendered repeatedly while batches stream in
     * faster than the client can re-sort.
     */
    private streamMedia(onComplete?: () => void) {
        const streamId = ++this.currentStreamId;
        const rows: IFeedItem[] = [];
        this.items = [];
        this.isLoading = true;

        const {isTorrents, filters} = this.query;
        IpcService.getMedia({isTorrents, genres: filters.noMediaWithoutGenres}, batch => {
            for (const item of batch || []) {
                if (item.poster) {
                    item.poster = posterUrl(item.poster);
                }
                rows.push(item);
            }
        }).then(() => {
            // Drop the result of a superseded stream.
            if (streamId !== this.currentStreamId) return;
            this.items = rows;
            this.isLoading = false;
            onComplete?.();
        }).catch(err => {
            if (streamId !== this.currentStreamId) return;
            console.error("streamMedia failed:", err);
            this.isLoading = false;
        });
    }

    /** Re-fetches the current view's data, keeping the scroll position. */
    public reloadInPlace() {
        const scrollTop = this.grid?.scrollPosition || 0;
        this.streamMedia(() => this.scrollGridTo(scrollTop));
    }

    /** Scrolls the grid once it has rendered the current rows. */
    private async scrollGridTo(y: number, behavior: ScrollBehavior = "auto") {
        await this.updateComplete;
        await this.grid?.updateComplete;
        this.grid?.scrollToY(y, behavior);
    }

    /** Moves keyboard focus to the library's cards. */
    public focusLibrary() {
        this.grid?.focusCards();
    }

    private showMediaType(mediaType: MediaType) {
        this.updateQuery({mediaType});
        if (PAGE_VIEWS.has(this.view)) {
            // the choice applies to the library, so go there
            this.navigate({view: "folders"});
        }
        this.closeSidePanel();
    }

    // ---- Chrome: side bar, server messages, layout -------------------------

    public openSidePanel(panel: SidePanel) {
        this.sidePanel = panel;
    }

    public closeSidePanel() {
        this.sidePanel = null;
        this.focusLibrary();
    }

    public toggleMenu() {
        if (this.sidePanel) {
            this.closeSidePanel();
        } else {
            this.openSidePanel("menu");
        }
    }

    // A click outside the side bar, top bar, pages and details closes the side bar.
    private onDocumentClick = (e: MouseEvent) => {
        if (this.sidePanel && !(e.target as HTMLElement).closest(".side-bar, .top-bar, .page, .video-details")) {
            this.closeSidePanel();
        }
    };

    /** A message pushed by the server: "reload*" refreshes its data view, anything else is status text. */
    private showServerMessage(msg: string) {
        if (msg in RELOAD_MESSAGES) {
            // Refresh the list only when it is the one on screen; never switch
            // views under the user. Other views fetch fresh data when opened.
            if (RELOAD_MESSAGES[msg] === this.view) {
                this.reloadInPlace();
            }
            return;
        }
        this.sweepStatus = msg;
        clearTimeout(this.sweepStatusTimer);
        this.sweepStatusTimer = setTimeout(() => {
            this.sweepStatus = "";
        }, 3000);
    }

    // Rotating a phone changes the poster size and how many fit in a row.
    // Height-only resizes (a mobile address bar sliding away) change neither.
    private layoutWidth = window.innerWidth;
    private onResize = () => {
        if (window.innerWidth === this.layoutWidth) {
            return;
        }
        this.layoutWidth = window.innerWidth;
        applyCardLayout();
        this.grid?.relayout();
    };

    // ---- Rendering -------------------------------------------------------

    private renderPage() {
        switch (this.view) {
            case "downloads":
                return html`<downloads-page></downloads-page>`;
            case "channels":
                return html`<rooster-channels></rooster-channels>`;
            case "lists":
                return this.route.listId
                    ? html`<list-detail .rooster=${this} .listId=${this.route.listId} .detailsOpen=${!!this.openItem}></list-detail>`
                    : html`<rooster-lists .rooster=${this}></rooster-lists>`;
            default:
                return html`<library-grid .rooster=${this} .library=${this.library}
                    .groupBy=${this.query.order.groupBy} .isTorrents=${this.query.isTorrents}
                    .showDebug=${this.query.filters.showDebug} .loading=${this.isLoading}></library-grid>`;
        }
    }

    public render() {
        const mediaTypeItem = (type: MediaType, icon: string, label: string) =>
            html`<li tabindex="0" class=${this.query.mediaType === type ? "active" : ""}
                @click=${() => this.showMediaType(type)}><i class="material-icons">${icon}</i>${label}</li>`;
        return html` ${this.sweepStatus
                ? html`<div class="status-wrap">
                      <div class="sweep-status"> ${this.sweepStatus} </div>
                  </div>`
                : ""}
            <top-bar .rooster=${this} .view=${this.view} .searchTerm=${this.query.search}></top-bar>
            <div class="side-bar ${this.sidePanel ? "open" : ""}">
                <ul>
                    ${mediaTypeItem("all", "video_library", "All Media")}
                    ${mediaTypeItem("movies", "movie", "Movies")}
                    ${mediaTypeItem("series", "live_tv", "Series")}
                    <li tabindex="0" @click=${() => this.openSidePanel("filters")}><i class="material-icons">filter_list</i>Filter</li>
                </ul>
                <ul>
                    <li tabindex="0" @click=${() => this.openSidePanel("settings")}><i class="material-icons">settings</i>Settings</li>
                </ul>
            </div>
            ${this.sidePanel
                // while the side bar is open the panel also covers the page, so a click outside closes it
                ? html`<div class="panel">
                      ${this.sidePanel === "filters" ? html`<filters-page .rooster=${this} .query=${this.query}></filters-page>` : ""}
                      ${this.sidePanel === "settings" ? html`<settings-page .rooster=${this}></settings-page>` : ""}
                  </div>`
                : ""}
            ${this.isLoading
                ? html`<div class="loading">
                      <div class="spinner"><div></div></div>
                      Loading
                  </div>`
                : ""}
            ${this.renderPage()}
            ${this.openItem
                // one details panel per card: a new card gets a fresh panel
                ? keyed(this.openItem.id, html`<video-details tabindex="${this.openItem.id}"
                      .rooster=${this} .video=${this.openItem}></video-details>`)
                : ""}`;
    }
}
