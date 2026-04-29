import {LitElement, html, TemplateResult} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import {keyed} from "lit/directives/keyed.js";
import {repeat} from "lit/directives/repeat.js";
import {IpcService} from "../services/ipc.service";
import "./TopBar";
import "./VideoCard";
import "./FiltersPage";
import "./SettingsPage";
import "./Channels";
import "./Lists";
import "./ListDetail";
import {type MetaData} from "../entity/MetaData";
import {IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {type User} from "../entity/User";
import {IConfig} from "../common/models/IConfig";
import {RoosterXWrapper} from "./RoosterXWrapper";
import {List} from "linqts";
import * as _ from "lodash";
import {type MediaFile} from "../entity/MediaFile";
import {type TorrentFile} from "../entity/TorrentFile";
import {VideoCard} from "./VideoCard";
import {TopBar} from "./TopBar";
import {fromNow} from "../common/commonUtils";

type OrderConfig = {
    directionDescending: boolean;
    orderBy: string;
    groupBy: string;
    showUnwatchedFirst: boolean;
};

interface FilterConfig {
    unwatchedMedia: boolean;
    noMediaWithoutFiles: boolean;
    noMediaWithoutMetaData: boolean;
    noMediaWithoutGenres: string[];
    showDebug?: boolean;
}

type GroupMetaData = {
    groupName: string;
    startY: number;
    endY: number;
    rowsInGroup: number;
    totalVideos: number;
    isExpanded: boolean;
}

type View = "folders" | "torrents" | "channels" | "lists";
type Route = {view: View | null; id: number | null};

// @ts-ignore
@customElement("rooster-x")
export class RoosterX extends LitElement {
    @property() public _media: MetaData[] = [];
    @property() public _torrents: MetaData[] = [];
    @property() public _filteredMedia: IMetaDataExtended[] | Map<string, IMetaDataExtended[]> = [];
    @property() public _sideBar: boolean = false;
    @property() public _panel: string = "";
    @property() public user: User;
    @property() public config: IConfig;
    @property() public wrapper: RoosterXWrapper;
    @property() public _filterConfig: any = {
        unwatchedMedia: false,
        noMediaWithoutFiles: true,
        noMediaWithoutMetaData: true,
        noMediaWithoutGenres: [],
        showDebug: false,
    };
    @property() public _orderConfig: OrderConfig = {
        directionDescending: true,
        orderBy: "trendingCount",
        groupBy: "none",
        // groupBy: "year",
        showUnwatchedFirst: true,
    };
    @property() public _sweepStatus: string = "";
    @property() public _sweepCount: string = "";
    @property() public _showTorrents: boolean = false;
    @query("top-bar") private topBar: TopBar;
    @query(".videos") public videos: HTMLElement;
    @state() public isLoading: boolean = false;
    private msgTimeout: number;
    @state() public view: View = "folders";
    // List detail view: when set, the lists view shows the items of this list.
    @state() public listDetailId: number | null = null;

    private torrentsViewScrollPos: number = 0;
    private foldersViewScrollPos: number = 0;

    @state()
    private videosOffset: number = 0;

    @state()
    private visibleGroupsData: {groupName: string; startY: number; endY: number; rowsInGroup: number; totalVideos: number}[] = [];
    private isGroupExpanded: Map<string, boolean> = new Map<string, boolean>();

    // Streaming support: monotonically increasing stream id used to ignore
    // chunks belonging to a superseded request (e.g. user changes view/filter
    // mid-stream).
    private currentStreamId: number = 0;
    // rAF handle for debouncing per-chunk refreshMedia calls.
    private streamRefreshRaf: number = 0;

    public createRenderRoot() {
        window["RoosterX"] = this;
        return this;
    }

    constructor() {
        super();
        this._sideBar = false;
        this._panel = "";

        // ----- Routing: URL is the source of truth -----
        // Routes:
        //   /                          -> default to last-view (localStorage) or folders
        //   /folders | /torrents | /channels
        //   /<view>/<movie|series|tv|episode>/<id>
        const route = this.parseRoute();
        let initialView: View;
        if (route.view) {
            initialView = route.view;
        } else {
            // Bare "/" -> use last-view hint, else folders.
            initialView = this.getLastView() || "folders";
            // Normalize URL so future navigation has a proper view prefix.
            history.replaceState({view: initialView}, "", `/${initialView}`);
        }
        this.view = initialView;
        this._showTorrents = initialView === "torrents";
        this.saveLastView(initialView);

        // The lists/channels views don't use the media grid dataset, so skip
        // the initial stream when the user lands directly on one of them.
        if (initialView !== "lists" && initialView !== "channels") {
            this.streamMedia({
                filter: "all",
                isTorrents: this._showTorrents,
                genres: this._filterConfig.noMediaWithoutGenres,
            }, {
                onComplete: () => {
                    // Deep-link support: if URL has /<view>/<type>/<id>, open it.
                    this.openCardFromUrl();
                },
            });
        }
        document.addEventListener("click", <HTMLElement>(e) => {
            if (
                e &&
                !e.target.closest(".side-bar") &&
                !e.target.closest(".top-bar") &&
                !e.target.closest(".page") &&
                !e.target.closest(".video-details")
            ) {
                if (this._sideBar) {
                    this._sideBar = false;
                    RoosterX.setFocusToVideos();
                }
            }
        });

        console.log("RoosterX sweep-update");
        console.log("RoosterX refresh-media");

        window.addEventListener("popstate", e => {
            console.log("popstate", e.state);
            const r = this.parseRoute();

            // If view changed (back/forward across views), switch dataset.
            if (r.view && r.view !== this.view) {
                this.applyView(r.view, /* push */ false);
                // Card opening (if any) happens after stream completes via
                // applyView's onComplete -> openCardFromUrl().
                return;
            }

            // For the lists view, the listDetailId was just synced inside
            // parseRoute(). Force a re-render so the detail/overview switch.
            if (this.view === "lists") {
                this.requestUpdate();
                return;
            }

            // Same view: handle card open/close based on URL id.
            const id = r.id;
            if (id) {
                const videoCard = document.getElementById(`v${id}`) as VideoCard;
                // @ts-ignore
                const openVideoCards = [...document.querySelectorAll("video-card[show-details=true]")] as VideoCard[];
                for (const card of openVideoCards) {
                    card !== videoCard && card.closeDetails(true);
                }
                if (videoCard && !videoCard.isShowDetails) {
                    videoCard.showDetails(false);
                }
            } else {
                // @ts-ignore
                const videoCards = document.querySelectorAll("video-card[show-details=true]") as VideoCard[];
                for (const videoCard of videoCards) {
                    videoCard.closeDetails(true);
                }
            }
        });

        // ipcRenderer.on("sweep-update", (e, data) => {
        //     // console.log("sweep-update", data);
        //     this.sweepStatus = data.status;
        //     this.sweepCount = data.count;
        // });
        //
        // ipcRenderer.on("refresh-media", (e, data) => {
        //     IpcService.getMedia().then(media => this.media = media);
        // });
    }

    private calculateHeightOffsetNoGroups() {
        requestAnimationFrame(() => {

            // check if its a grouped view
            if (this._filteredMedia instanceof Map) {
                return;
            }

            const videosInARow = this.getNumOfVideosInARow();
            console.log("videosInARow", videosInARow);

            const videoHeight = 314;
            // @ts-ignore
            const totalVideos = this._filteredMedia?.length || 0;
            const videoRows = Math.ceil(totalVideos / videosInARow);
            const height = videoRows * videoHeight + 22.4 * (videoRows - 1) + 44.8;
            this.videos.style.height = `${height}px`;
            console.log("height", height);

            const scrollHeight = this.videos.parentElement?.scrollTop || 0;

            console.log("scrollHeight", scrollHeight);

            const rowHeight = height / videoRows;
            const videosOffset = (Math.floor(scrollHeight / rowHeight) - 5) * videosInARow;
            this.videosOffset = videosOffset;
            console.log("videosOffset", videosOffset);

            if (videosOffset > 0) {
                this.videos.style.paddingTop = (videosOffset / videosInARow) * rowHeight + "px";
            } else {
                this.videos.style.paddingTop = "1.4rem";
            }

            this.videos.parentElement?.addEventListener(
                "scroll",
                () => {
                    this.calculateHeightOffsetNoGroups();
                },
                {once: true},
            );
        });
    }

    private calculateHeightOffsetWithGroups() {
        requestAnimationFrame(() => {
            const videosInARow = this.getNumOfVideosInARow();
            const videoHeight = 314;
            const groupMargin = 0; //22.4; // Margin between groups
            const groupTitleHeight = 0; //32.35 + groupMargin; // Height of the group header/title
            const rowGap = 22.4; // Gap between rows of cards
            
            // Build group metadata
            const groupsMetadata: GroupMetaData[] = [];
            let currentY = 0;
            let totalHeight = 0;
            
            if (!(this._filteredMedia instanceof Map)) {
                return; // Not a grouped view
            }
            
            // Calculate dimensions for each group
            for (const [groupName, videos] of this._filteredMedia) {
                if (!this.isGroupExpanded.has(groupName)) {
                    this.isGroupExpanded.set(groupName, true);
                }
                const isExpanded = this.isGroupExpanded.get(groupName)!;
                const rowsInGroup = Math.ceil(videos.length / videosInARow);
                const videosHeight = isExpanded ? (rowsInGroup * videoHeight) + ((rowsInGroup - 1) * rowGap) : 0;
                const groupHeight = groupTitleHeight + videosHeight - rowGap;
                
                groupsMetadata.push({
                    groupName,
                    startY: Math.round(currentY),
                    endY: Math.round(currentY + groupHeight + groupMargin),
                    rowsInGroup,
                    totalVideos: videos.length,
                    isExpanded: isExpanded,
                });
                
                currentY += groupHeight + groupMargin;
                totalHeight += groupHeight + groupMargin;
            }

            console.log("totalHeight", totalHeight);
            
            // Set total height
            this.videos.style.height = `${totalHeight}px`;
            
            // Get current scroll position
            const scrollHeight = this.videos.parentElement?.scrollTop || 0;
            
            // Determine visible range (buffer before and after viewport)
            const viewportHeight = this.videos.parentElement?.clientHeight || 0;
            const visibleStartY = Math.max(0, scrollHeight - viewportHeight * 2); // Buffer above
            const visibleEndY = scrollHeight + (viewportHeight * 2); // Buffer below

            console.log("visibleStartY", visibleStartY, "visibleEndY", visibleEndY);
            console.log("groupsMetadata", groupsMetadata);

            // Find visible groups
            this.findVisibleGroups(groupsMetadata, visibleStartY, visibleEndY);

            console.log("visibleGroupsData", this.visibleGroupsData);
            
            // Calculate padding (only if we have visible groups)
            if (this.visibleGroupsData.length > 0) {
                const firstVisibleGroup = this.visibleGroupsData[0];
                this.videos.style.paddingTop = `${firstVisibleGroup.startY || 0}px`;
                
                // Log for debugging
                console.log(`Visible groups: ${this.visibleGroupsData.length}, First group: ${firstVisibleGroup.groupName}`);
            } else {
                this.videos.style.paddingTop = "1.4rem";
            }

                // Re-attach scroll handler
                this.videos.parentElement?.addEventListener(
                    "scroll",
                    () => {
                        this.calculateHeightOffsetWithGroups();
                    },
                    { once: true }
                )
        });
    }
    
    private findVisibleGroups(groupsMetadata: any[], visibleStartY: number, visibleEndY: number): void {
        let foundFirst = false;
        const visibleGroups: any = [];
        for (const group of groupsMetadata) {
            if (
                // Check if the group is within the visible range
                (group.startY >= visibleStartY && group.endY <= visibleEndY) ||
                // Check if the group starts before and ends within the visible range
                (group.endY >= visibleStartY && group.endY <= visibleEndY) ||
                // Check if the group starts within and ends after the visible range
                (group.startY >= visibleStartY && group.startY <= visibleEndY) ||
                // Check if the group starts before and ends after the visible range
                (group.startY <= visibleStartY && group.endY >= visibleEndY)
            ) {
                foundFirst = true;
                visibleGroups.push(group);
            }
            // if (foundFirst && group.startY > visibleEndY) {
            //     break;
            // }
        }
        if (visibleGroups.length <= 0) {
            return;
        }

        // add the group before the first visible group
        const beforeIndex = groupsMetadata.indexOf(visibleGroups[0]) - 1;
        if (beforeIndex >= 0) {
            const beforeGroup = groupsMetadata[beforeIndex];
            visibleGroups.unshift(beforeGroup);
        }

        // add the group after the last visible group
        const afterIndex = groupsMetadata.indexOf(visibleGroups.at(-1)) + 1;
        if (afterIndex < groupsMetadata.length) {
            const afterGroup = groupsMetadata[afterIndex];
            visibleGroups.push(afterGroup);
        }


        if (this.visibleGroupsData.length === 0 || this.visibleGroupsData.length !== visibleGroups.length) {
            this.visibleGroupsData = visibleGroups;
            return;
        }
        if (this.visibleGroupsData.length === visibleGroups.length) {
            for (const i in this.visibleGroupsData) {
                if (visibleGroups[i].groupName !== this.visibleGroupsData[i].groupName) {
                    this.visibleGroupsData = visibleGroups;
                    return;
                }
            }
        }
    }

    private getNumOfVideosInARow(): number {
        // globalThis.videosScrollPos = this.videos.scrollTop;
        const width = window.innerWidth - 10;

        // calculate how many videos fit in a row, include gaps between them
        let videosInARow: number = Math.floor(width / 224);
        const estimatedWidth = videosInARow * 224 + (videosInARow - 1) * 22.4;
        if (width > estimatedWidth) {
            return videosInARow;
        } else if (estimatedWidth >= width) {
            videosInARow--;
        }

        return videosInARow;
    }

    /**
     * Parse the current URL pathname into {view, id}. Supported shapes:
     *   /folders | /torrents | /channels
     *   /<view>/<movie|series|tv|episode>/<id>
     */
    private parseRoute(): Route {
        // /lists                         — overview
        // /lists/<listId>                — single list detail
        // /lists/<listId>/<type>/<id>    — card opened inside a list
        const listMatch = window.location.pathname.match(
            /^\/lists(?:\/(\d+)(?:\/(?:movie|series|tv|episode)\/(\d+))?)?\/?$/,
        );
        if (listMatch) {
            const listId = listMatch[1] ? Number(listMatch[1]) : null;
            const cardId = listMatch[2] ? Number(listMatch[2]) : null;
            this.listDetailId = listId !== null && Number.isFinite(listId) ? listId : null;
            return {
                view: "lists",
                id: cardId !== null && Number.isFinite(cardId) ? cardId : null,
            };
        }
        const m = window.location.pathname.match(
            /^\/(folders|torrents|channels)(?:\/(?:movie|series|tv|episode)\/(\d+))?\/?$/,
        );
        if (!m) return {view: null, id: null};
        const id = m[2] ? Number(m[2]) : null;
        return {
            view: m[1] as View,
            id: id !== null && Number.isFinite(id) ? id : null,
        };
    }

    /** The base URL for the current view, used by VideoCard for pushState. */
    public currentViewPath(): string {
        return `/${this.view}`;
    }

    private static LAST_VIEW_KEY = "roosterx-last-view";

    private getLastView(): View | null {
        try {
            const v = localStorage.getItem(RoosterX.LAST_VIEW_KEY);
            if (v === "folders" || v === "torrents" || v === "channels" || v === "lists") return v;
        } catch (_) {}
        return null;
    }

    private saveLastView(view: View) {
        try {
            localStorage.setItem(RoosterX.LAST_VIEW_KEY, view);
        } catch (_) {}
    }

    /**
     * Switch to a view. Updates state, optionally pushes a history entry,
     * persists last-view, and (for data views) re-streams data. After the
     * stream completes, openCardFromUrl is invoked so back/forward to a
     * /<view>/<type>/<id> URL still opens the correct card.
     */
    private applyView(view: View, push: boolean) {
        // Save scroll position of the outgoing data view.
        if (this.view === "folders" && view !== "folders") {
            this.foldersViewScrollPos = this.videos?.parentElement?.scrollTop || 0;
        } else if (this.view === "torrents" && view !== "torrents") {
            this.torrentsViewScrollPos = this.videos?.parentElement?.scrollTop || 0;
        }

        this.view = view;
        this._showTorrents = view === "torrents";
        this.saveLastView(view);

        if (push) {
            history.pushState({view}, "", `/${view}`);
        }

        if (view === "channels" || view === "lists") {
            this.closeSideBar && this.closeSideBar();
            return;
        }

        const restoreScroll = view === "torrents" ? this.torrentsViewScrollPos : this.foldersViewScrollPos;
        this.streamMedia({
            filter: "all",
            isTorrents: this._showTorrents,
            genres: this._filterConfig.noMediaWithoutGenres,
        }, {
            onComplete: () => {
                this.updateComplete.then(() => {
                    RoosterX.setFocusToVideos();
                    this.videos?.parentElement?.scrollTo({top: restoreScroll, behavior: "smooth"});
                });
                // If the URL also has an /<type>/<id> suffix (e.g. arrived
                // here via popstate), open the deep-linked card.
                this.openCardFromUrl();
            },
        });
        this.closeSideBar && this.closeSideBar();
    }

    /**
     * Deep-link entry point: open the card identified by the URL, if its id
     * exists in the current view's dataset. If not, strip the id off the URL
     * (keeping the view prefix). Tolerates virtual scrolling by retrying
     * across animation frames.
     */
    private openCardFromUrl() {
        const route = this.parseRoute();
        const id = route.id;
        if (!id) return;

        // Only act when the URL view matches the current view.
        if (route.view && route.view !== this.view) return;

        const list = this._showTorrents ? this._torrents : this._media;
        const inDataset = Array.isArray(list) && (list as IMetaDataExtended[]).some(m => m.id === id);
        if (!inDataset) {
            console.warn("Deep link: id not found in current view, dropping id from URL:", id);
            history.replaceState({view: this.view}, "", `/${this.view}`);
            return;
        }

        // Ensure history state carries the id so popstate can restore it.
        history.replaceState({view: this.view, id}, "", window.location.pathname);

        const tryOpen = (attempt = 0) => {
            const card = document.getElementById(`v${id}`) as VideoCard | null;
            if (card) {
                card.scrollIntoView({block: "center"});
                if (!card.isShowDetails) {
                    card.showDetails(false);
                }
                return;
            }
            // Card not in DOM yet (virtualization). Scroll near its row to
            // force it to render, then retry.
            if (this.videos && Array.isArray(this._filteredMedia)) {
                const idx = (this._filteredMedia as IMetaDataExtended[]).findIndex(m => m.id === id);
                if (idx >= 0) {
                    const videosInARow = this.getNumOfVideosInARow() || 1;
                    const row = Math.floor(idx / videosInARow);
                    const approxY = row * (314 + 22.4);
                    this.videos.parentElement?.scrollTo({top: approxY, behavior: "auto"});
                }
            }
            if (attempt < 60) {
                requestAnimationFrame(() => tryOpen(attempt + 1));
            } else {
                console.warn("Deep link: could not find card for id", id);
            }
        };

        requestAnimationFrame(() => tryOpen(0));
    }

    connectedCallback() {
        super.connectedCallback();
        // load filter config from local storage
        this._orderConfig = this.orderConfig || this._orderConfig;
        this._filterConfig = this.filterConfig || this._filterConfig;
    }

    set showMsg(value: string) {
        this._sweepStatus = value;
        if (value === "reload") {
            this.topBar.showFolders();
        } else if (value === "reload-torrents") {
            this.topBar.showTorrents();
        }
        clearTimeout(this.msgTimeout);
        this.msgTimeout = setTimeout(() => {
            this._sweepStatus = "";
            this.requestUpdate();
        }, 3000);
        this.requestUpdate();
    }

    set media(data) {
        console.log("new data", data);
        this._media = data;
        this.refreshMedia(data);
    }

    set filterConfig(data: any) {
        // Capture old genres BEFORE updating state/localStorage
        const oldGenres = [...(this._filterConfig?.noMediaWithoutGenres || [])];
        const newGenres = data.noMediaWithoutGenres || [];
        const genresChanged = JSON.stringify([...oldGenres].sort()) !== JSON.stringify([...newGenres].sort());
        
        console.log("filterConfig setter - oldGenres:", oldGenres, "newGenres:", newGenres, "genresChanged:", genresChanged);
        
        this._filterConfig = data;
        // save filter config to local storage
        const localStorageKey = this.getLocalStorageKey("filterConfig");
        localStorage.setItem(localStorageKey, JSON.stringify(data));
        
        if (genresChanged) {
            // Refetch data from backend with new genre filter
            console.log("Genres changed! Calling getMedia with genres:", this._filterConfig.noMediaWithoutGenres);
            this.getMedia();
        } else {
            // Just refresh with existing data (local filtering)
            this.media = this._media;
        }
    }

    get filterConfig(): FilterConfig | undefined {
        const localStorageKey = this.getLocalStorageKey("filterConfig");
        const data = localStorage.getItem(localStorageKey);
        return data ? JSON.parse(data) : undefined;
    }

    set orderConfig(data: any) {
        this._orderConfig = data;
        // save order config to local storage
        const localStorageKey = this.getLocalStorageKey("orderConfig");
        localStorage.setItem(localStorageKey, JSON.stringify(data));
        this.media = this._media;
    }
    get orderConfig(): OrderConfig | undefined {
        const localStorageKey = this.getLocalStorageKey("orderConfig");
        const data = localStorage.getItem(localStorageKey);
        return data ? JSON.parse(data) : undefined;
    }

    getLocalStorageKey(prefix: string): string {
        return `${prefix}-${this._showTorrents ? "torr" : "down"}-${this.user.id}`;
    }

    public refreshMedia(data?, preserveGroupState: boolean = false) {
        console.log("refreshMedia", data);
        this._orderConfig = this.orderConfig || this._orderConfig;
        this._filterConfig = this.filterConfig || this._filterConfig;
        if (!preserveGroupState) {
            this.isGroupExpanded = new Map<string, boolean>();
        }
        if (this._showTorrents) {
            if (data) {
                this._filteredMedia = this.prepareMediaTorrents(data);
            } else {
                this._filteredMedia = this.prepareMediaTorrents(this._torrents);
            }
            this._filteredMedia = this.filterTorrents(this._filteredMedia);
        } else {
            if (data) {
                console.log("prepareMedia", data);
                this._filteredMedia = this.prepareMedia(data);
            } else {
                this._filteredMedia = this.prepareMedia(this._media);
            }
            this._filteredMedia = this.filterMedia(this._filteredMedia);
        }

        let tmpMediaArray: IMetaDataExtended[] | Map<string, IMetaDataExtended[]> = [...this._filteredMedia];

        // group media
        if (this._orderConfig.groupBy && this._orderConfig.groupBy !== "none") {
            tmpMediaArray = this.groupBy(tmpMediaArray, this._orderConfig.groupBy);
            console.log("grouped:", tmpMediaArray);
        }

        // check if grouped media is a map
        if (tmpMediaArray instanceof Map) {
            // sort media for each group
            for (const [key, arr] of tmpMediaArray) {
                tmpMediaArray.set(key, this.sortMedia(arr));
            }
        } else {
            // sort media
            tmpMediaArray = this.sortMedia(tmpMediaArray);
        }

        console.log("grouped 2:", tmpMediaArray);
        this._filteredMedia = tmpMediaArray;

        console.log("sorted:", this._filteredMedia);
        this.requestUpdate();
    }

    groupBy(mediaArray: IMetaDataExtended[], groupBy: string): Map<string, IMetaDataExtended[]> {
        const result: Map<string, IMetaDataExtended[]> = new Map();
        if (groupBy === "genres") {
            const tmpResult = {};
            // for each media, split the genres
            for (const media of mediaArray) {
                if (media.genres) {
                    if (media.genres.includes(",")) {
                        const genres = media.genres.split(",");
                        for (const genre of genres) {
                            if (!tmpResult[genre]) {
                                tmpResult[genre] = [];
                            }
                            tmpResult[genre].push(media);
                        }
                    } else {
                        if (!tmpResult[media.genres]) {
                            tmpResult[media.genres] = [];
                        }
                        tmpResult[media.genres].push(media);
                    }
                }
            }
            // sort the groups by most media
            const keys = Object.keys(tmpResult);
            keys.sort((a, b) => tmpResult[a].length - tmpResult[b].length);
            for (const key of keys) {
                result.set(key + ` (${tmpResult[key].length})`, tmpResult[key]);
            }
        } else {
            let linqList = new List<IMetaDataExtended>([...mediaArray]);

            const grouped = linqList.GroupBy((x: IMetaDataExtended) => x[groupBy]) as Record<
                string,
                IMetaDataExtended[]
            >;

            // sort the groups
            const keys = Object.keys(grouped).sort((a, b) => (a > b ? 1 : -1));
            console.log("keys", keys);
            if (this._orderConfig.directionDescending) {
                keys.reverse();
            }
            console.log("keys2", keys);
            for (const i in keys) {
                if (keys[i] !== "null") {
                    result.set(keys[i], grouped[keys[i]]);
                }
            }
            result.set("N/A", grouped["null"]);
        }
        return result;
    }

    private sortMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        if (!list || list.length === 0) {
            return [];
        }
        // Native Array.sort with a single combined comparator. Significantly
        // faster than linqts + lodash chained passes (no intermediate
        // allocations, single O(n log n) pass).
        const orderKey = this._orderConfig.orderBy;
        const dirSign = this._orderConfig.directionDescending ? -1 : 1;
        const showUnwatchedFirst = !!this._orderConfig.showUnwatchedFirst;
        const result = list.slice();
        // Tie-breaker chain: when the primary key is equal (e.g. items share
        // the same rating inside a group), fall back to release date, then
        // year, so the ordering is deterministic and "newest wins" instead
        // of random/insertion order.
        const tieKeys = ["released_unix", "year"].filter(k => k !== orderKey);
        const compareKey = (a: IMetaDataExtended, b: IMetaDataExtended, key: string, sign: number) => {
            const av = a[key];
            const bv = b[key];
            if (av === bv) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return av < bv ? -1 * sign : 1 * sign;
        };
        result.sort((a, b) => {
            if (showUnwatchedFirst) {
                const aw = a.isWatched ? 1 : 0;
                const bw = b.isWatched ? 1 : 0;
                if (aw !== bw) return aw - bw; // unwatched (0) first
            }
            const primary = compareKey(a, b, orderKey, dirSign);
            if (primary !== 0) return primary;
            for (const k of tieKeys) {
                const cmp = compareKey(a, b, k, -1); // always newest-first on ties
                if (cmp !== 0) return cmp;
            }
            return 0;
        });
        return result;
    }

    private prepareMedia(metaDataList: MetaData[]): IMetaDataExtended[] {
        if (!metaDataList) {
            return [];
        }
        // Note: the GetMedia payload is flat (no nested torrentFiles/mediaFiles
        // arrays) so the previous _.maxBy(...) latestChange computation was
        // dead code and has been removed.
        const newList: IMetaDataExtended[] = metaDataList as IMetaDataExtended[];
        for (const me of newList) {
            if (me.poster && !me.poster.startsWith("http")) {
                me.poster = `https://image.tmdb.org/t/p/w300${me.poster}`;
            }
        }
        return newList;
    }

    private prepareMediaTorrents(metaDataList: MetaData[]): IMetaDataExtended[] {
        if (!metaDataList) {
            return [];
        }
        const newList: IMetaDataExtended[] = metaDataList as IMetaDataExtended[];
        for (const me of newList) {
            if (me.poster && !me.poster.startsWith("http")) {
                me.poster = `https://image.tmdb.org/t/p/w300${me.poster}`;
            }
        }
        return newList;
    }

    private filterMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        // filter watched
        if (this._filterConfig.unwatchedMedia) {
            list = list.filter(m => !m.isWatched);
        }

        // filter media entries that don't have any files
        if (this._filterConfig.noMediaWithoutFiles) {
            // @ts-ignore
            list = list.filter(m => !!m.mediaFiles && m.mediaFiles > 0);
        }

        // filter media entries that don't have metaData from imdb
        // if (this._filterConfig.noMediaWithoutMetaData) {
        //     list = list.filter((m) => m.status !== "failed");
        // }

        return list;
    }

    private filterTorrents(list: IMetaDataExtended[]): IMetaDataExtended[] {
        // filter media with files
        // list = list.filter((m) => m.mediaFiles?.length === 0 && m.torrentFiles.length > 0);

        // filter watched
        if (this._filterConfig.unwatchedMedia) {
            list = list.filter(m => !m.isWatched);
        }

        // filter media entries that don't have meta data from imdb
        if (this._filterConfig.noMediaWithoutMetaData) {
            list = list.filter(m => m.status !== "failed");
        }

        return list;
    }

    public showChannels() {
        this.applyView("channels", /* push */ true);
    }

    public showLists() {
        this.listDetailId = null;
        history.pushState({view: "lists"}, "", "/lists");
        this.applyView("lists", /* push */ false);
    }

    /** Open the detail page for one list. */
    public openList(listId: number) {
        this.listDetailId = listId;
        history.pushState({view: "lists", listId}, "", `/lists/${listId}`);
        this.applyView("lists", /* push */ false);
    }

    public showTorrents() {
        this.applyView("torrents", /* push */ true);
    }

    public showFolders() {
        this.applyView("folders", /* push */ true);
    }

    /**
     * Streaming variant of getMedia. Resets the relevant collection, requests
     * the data over IPC, and appends each chunk to an internal buffer.
     *
     * Refresh policy: do NOTHING during the stream - just accumulate. The
     * loading spinner stays up until the very last chunk arrives, then we
     * run a single sort/group/filter pass and render the final view. This
     * avoids the "live sorting" card-shuffle effect that happens when
     * intermediate datasets are sorted/rendered repeatedly while batches
     * stream in faster than the client can re-sort.
     *
     * Group-expand state is preserved across the final refresh so the
     * user's prior clicks aren't clobbered.
     */
    private streamMedia(payload: {filter: "movies" | "series" | "all", isTorrents: boolean, genres?: string[]}, opts?: {onComplete?: () => void}) {
        const streamId = ++this.currentStreamId;
        if (this.streamRefreshRaf) {
            cancelAnimationFrame(this.streamRefreshRaf);
            this.streamRefreshRaf = 0;
        }

        // Reset the appropriate collection at stream start.
        if (payload.isTorrents) {
            this._torrents = [];
        } else {
            this._media = [];
        }
        this._filteredMedia = [];
        this.isLoading = true;

        const onBatch = (batch: any[]) => {
            // Drop chunks belonging to an outdated stream.
            if (streamId !== this.currentStreamId) return;
            if (!batch || !batch.length) return;
            // Append silently - no render until the stream completes.
            if (payload.isTorrents) {
                this._torrents = this._torrents.concat(batch);
            } else {
                this._media = this._media.concat(batch);
            }
        };

        return IpcService.getMedia(payload, onBatch).then(() => {
            if (streamId !== this.currentStreamId) return;
            const dataset = payload.isTorrents ? this._torrents : this._media;
            this.refreshMedia(dataset, /* preserveGroupState */ true);
            this.isLoading = false;
            opts?.onComplete && opts.onComplete();
        }).catch(err => {
            if (streamId !== this.currentStreamId) return;
            console.error("streamMedia failed:", err);
            this.isLoading = false;
        });
    }

    public getMedia() {
        this.streamMedia({
            filter: "all",
            isTorrents: this._showTorrents,
            genres: this._filterConfig.noMediaWithoutGenres,
        });
        RoosterX.setFocusToVideos();
        this.closeSideBar && this.closeSideBar();
    }

    private getMovies() {
        this.streamMedia({
            filter: "movies",
            isTorrents: this._showTorrents,
            genres: this._filterConfig.noMediaWithoutGenres,
        });
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    private getSeries() {
        this.streamMedia({
            filter: "series",
            isTorrents: this._showTorrents,
            genres: this._filterConfig.noMediaWithoutGenres,
        });
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    public showFilters() {
        this.openSideBar("filters");
    }

    private showSettings() {
        this.openSideBar("settings");
    }

    public static setFocusToVideos() {
        const videos = document.querySelector(".videos") as HTMLElement;
        if (videos) {
            videos.focus();
        }
    }

    public openSideBar(panel: string = "") {
        this._panel = panel;
        this._sideBar = true;
        this.requestUpdate();
    }

    public closeSideBar() {
        this._panel = "";
        this._sideBar = false;
        RoosterX.setFocusToVideos();
        this.requestUpdate();
    }

    public toggleSideBar(panel: string = "") {
        if (this._sideBar) {
            this.closeSideBar();
        } else {
            this.openSideBar(panel);
        }
    }

    private getVideoCard(v: IMetaDataExtended) {
        return html`<video-card id="v${v.id}" .video=${v} .rooster=${this} .showDebug=${!!this._filterConfig?.showDebug}></video-card>`;
    }

    private toggleGroup(e) {
        const toggleWrapper = e.target.closest(".group-header") as HTMLElement;
        const group = toggleWrapper?.nextElementSibling as HTMLElement;
        const groupName = toggleWrapper.querySelector("a")?.href?.split("#")[1];
        console.log("toggleGroup", groupName);
        if (groupName) {
            this.isGroupExpanded.set(groupName, !this.isGroupExpanded.get(groupName));
        }
        if (group) {
            toggleWrapper.classList.toggle("open");
            group.classList.toggle("open");
        }
        this.calculateHeightOffsetWithGroups();
    }

    private getVideoCards() {
        if (!this._filteredMedia || !this.videos) {
            return;
        }

        if (this._filteredMedia instanceof Map) {
            const getGroupTitleFunc = (oc: OrderConfig): ((group: string) => string) => {
                if (oc.groupBy === "rating") {
                    return group => (group ? group : "N/A");
                }
                if (oc.groupBy === "genres") {
                    return group => (group ? group : "N/A");
                }
                if (oc.groupBy === "uploadedDate") {
                    return group => {
                        if (group === "null") {
                            return "N/A";
                        }

                        const title = group ? fromNow(group) : "N/A";
                        return title;
                    };
                }
                if (oc.groupBy === "downloadedDate") {
                    return group => (group === "null" ? "N/A" : group ? new Date(group).toLocaleDateString() : "N/A");
                }
                if (oc.groupBy === "quality") {
                    return group => (group ? group : "N/A");
                }
                if (oc.groupBy === "resolution") {
                    return group => (group === "0" ? "N/A" : group ? group + "p" : "N/A");
                }
                if (oc.groupBy === "year") {
                    return group => (group ? group.toString() || "N/A" : "N/A");
                }
                return v => "";
            };

            setTimeout(() => {
                const groupHeaders = document.querySelectorAll(".group-header");
                // add intersection observer for all the sticky group-headers
                // if its above half the screen, add a class to make it z-index: 1
                const observer = new IntersectionObserver(
                    entries => {
                        entries.forEach(entry => {
                            // console.log("observer entry:", entry);
                            const target = entry.target as HTMLElement;
                            // trigger only if the group-header is above half the screen
                            if (entry.intersectionRatio > 0.5) {
                                target.classList.add("top-layer");
                                // target.style.zIndex = "" + groupHeaders.length;
                            } else {
                                target.classList.remove("top-layer");
                                // target.style.zIndex = "1";
                            }
                        });
                    },
                    {
                        root: null,
                        rootMargin: "0px 0px -200px 0px",
                        threshold: 0.5,
                    },
                );
                groupHeaders.forEach(groupHeader => {
                    observer.observe(groupHeader);
                });
            }, 5000);

            // Apply virtual scrolling for grouped view
            this.calculateHeightOffsetWithGroups();
            
            // this is a record
            const result: TemplateResult[] = [];
            const getGroupTitle = getGroupTitleFunc(this._orderConfig);
            let index = this._filteredMedia.size;



            for (const group of this.visibleGroupsData) {
                index--;
                const key = group.groupName
                const arr = this._filteredMedia.get(group.groupName);
                result.push(
                    html` <div class="group-header open" style="z-index: ${index}">
                            <div @click="${this.toggleGroup}" class="material-icons mini">keyboard_arrow_down</div>
                            <div @click="${this.toggleGroup}" class="material-icons maxi">chevron_right</div>
                            &nbsp;
                            <a href="#${key}">${getGroupTitle(key)}</a>
                        </div>
                        <div id="${key}" class="group open">
                            <div class="group-videos">
                                ${repeat(
                                    arr,
                                    v => "" + v.id + (this._showTorrents ? "-tor" : ""),
                                    (v, i) =>
                                        html` <video-card id="v${v.id}" .video=${v} .rooster=${this} .showDebug=${!!this._filterConfig?.showDebug}></video-card>`,
                                )}
                            </div>
                        </div>`,
                );
            }
            return result;
        } else {
            // this is an array
            this.calculateHeightOffsetNoGroups();
            const offset = this.videosOffset < 0 ? 0 : this.videosOffset;
            return this._filteredMedia.slice(offset, offset + 80).map(v => this.getVideoCard(v));
            // return (this._filteredMedia as IMetaDataExtended[]).map(v => this.getVideoCard(v));
        }
    }

    public goToTop() {
        const videos = document.querySelector(".videos") as HTMLElement;
        videos.parentElement?.scrollTo({top: 0, behavior: "smooth"});
    }

    public render() {
        return html` ${this._sweepStatus
                ? html`<div class="status-wrap">
                      <div class="sweep-status"> ${this._sweepStatus} </div>
                  </div>`
                : ""}
            <top-bar .rooster=${this}></top-bar>
            <div class="side-bar ${this._sideBar ? "open" : ""}">
                <ul>
                    <li tabindex="0" @click=${this.getMedia}><i class="material-icons">video_library</i>All Media</li>
                    <li tabindex="0" @click=${this.getMovies}><i class="material-icons">movie</i>Movies</li>
                    <li tabindex="0" @click=${this.getSeries}><i class="material-icons">live_tv</i>Series</li>
                    <li tabindex="0" @click=${this.showFilters}><i class="material-icons">filter_list</i>Filter</li>
                </ul>
                <ul>
                    <li tabindex="0" @click=${this.showSettings}><i class="material-icons">settings</i>Settings</li>
                </ul>
            </div>
            ${this._sideBar
                ? html`<div class="panel">
                      ${this._panel === "filters" ? html`<filters-page .rooster=${this}></filters-page>` : ""}
                      ${this._panel === "settings" ? html`<settings-page .rooster=${this}></settings-page>` : ""}
                  </div>`
                : ""}
            ${this.isLoading
                ? html`<div class="loading">
                      <div class="spinner"><div></div></div>
                      Loading
                  </div>`
                : ""}
            ${this.view === "channels"
                ? html`<rooster-channels></rooster-channels>`
                : this.view === "lists"
                ? (this.listDetailId
                    ? html`<list-detail .rooster=${this} .listId=${this.listDetailId}></list-detail>`
                    : html`<rooster-lists .rooster=${this}></rooster-lists>`)
                : html` <div style="overflow-y: auto; overflow-x: hidden; display: block; height: calc(100vh - 64px);">
                      <div
                          class="videos"
                          tabindex="0"
                          ?hidden="${this.isLoading}"
                          style="height: 2000px; overflow: visible;align-content: flex-start;">
                          ${this.getVideoCards()}
                          <button class="goTop" @click="${this.goToTop}"> arrow_circle_up </button>
                      </div></div
                  >`}`;
    }
}
