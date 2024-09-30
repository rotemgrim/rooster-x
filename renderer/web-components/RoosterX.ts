
import {LitElement, html, TemplateResult} from "lit";
import {customElement, property, query} from "lit/decorators.js";
import {keyed} from "lit/directives/keyed.js";
import {repeat} from "lit/directives/repeat.js";
import {IpcService} from "../services/ipc.service";
import "./TopBar";
import "./VideoCard";
import "./FiltersPage";
import "./SettingsPage";
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


export function isStringContains(str, items) {
    if (str) {
        str = str.toLowerCase();
        for (const item of items) {
            if (str.includes(item)) {
                return true;
            }
        }
    }
    return false;
}

type OrderConfig = {
    directionDescending: boolean;
    orderBy: string;
    groupBy: string;
    showUnwatchedFirst: boolean;
}

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
    @property() public _showTorrents: boolean = false
    @query("top-bar") private topBar: TopBar;
    private msgTimeout: number;

    public createRenderRoot() {
        window["RoosterX"] = this;
        return this;
    }

    constructor() {
        super();
        this._sideBar = false;
        this._panel = "";
        IpcService.getMedia({
            filter: "all",
            isTorrents: this._showTorrents
        }).then(media => this.media = media);
        document.addEventListener("click", <HTMLElement>(e) => {
            if (e && !e.target.closest(".side-bar")
                && !e.target.closest(".top-bar")
                && !e.target.closest(".page")
                && !e.target.closest(".video-details")
            ) {
                if (this._sideBar) {
                    this._sideBar = false;
                    RoosterX.setFocusToVideos();
                }
            }
        });

        console.log("RoosterX sweep-update");
        console.log("RoosterX refresh-media");

        window.addEventListener('popstate', (e) => {
            console.log("popstate", e.state);

            const id = e.state.id || "";

            if (id) {
                const videoCard = document.getElementById(`v${id}`) as VideoCard;
                // get all video cards and close them
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
                if (videoCards.length > 0) {
                    for (const videoCard of videoCards) {
                        videoCard.closeDetails(true);
                    }
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

    set filterConfig(data) {
        this._filterConfig = data;
        this.media = this._media;
    }

    set orderConfig(data) {
        this._orderConfig = data;
        this.media = this._media;
    }

    public refreshMedia(data?) {
        console.log("refreshMedia", data);
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

            const grouped = linqList.GroupBy((x: IMetaDataExtended) => x[groupBy]) as Record<string, IMetaDataExtended[]>;

            // sort the groups
            const keys = Object.keys(grouped).sort((a, b) => a > b ? 1 : -1);
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
        if (!list) {
            return [];
        }
        const linqList = new List<IMetaDataExtended>([...list]);
        let newList: List<IMetaDataExtended>;

        if (this._orderConfig.directionDescending) {
            newList = linqList.OrderByDescending((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        } else {
            newList = linqList.OrderBy((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        }

        let mediaArray = newList.ToArray();
        let result;
        if (this._orderConfig.showUnwatchedFirst) {
            // sort by watched boolean
            mediaArray = _.orderBy(mediaArray, [(m)=>m.isWatched ? 0 : 1], "desc");
            // mediaArray = _.orderBy(mediaArray, ["isWatched"], ["desc"]);
        }
        result = mediaArray;

        return result;
    }


    private prepareMedia(metaDataList: MetaData[]): IMetaDataExtended[] {
        if (!metaDataList) {
            return [];
        }
        const newList: IMetaDataExtended[] = [...metaDataList];
        for (const me of newList) {

            // me.poster = me.poster ? `https://image.tmdb.org/t/p/original${me.poster}` : "";
            if (me.poster && !me.poster.startsWith("http")) {
                me.poster = `https://image.tmdb.org/t/p/w300${me.poster}`;
            }
            // check if media is watched
            // if (me.userMetaData.filter(x => x.isWatched && x.userId === this.user.id).length > 0) {
            //     me.isWatched = true;
            // }

            let latestMedia: MediaFile | TorrentFile | undefined;
            if (this._showTorrents) {
                latestMedia = _.maxBy(me.torrentFiles, (o) => {
                    return new Date(o.uploadedAt).getTime();
                });
            } else {
                latestMedia = _.maxBy(me.mediaFiles, (o) => {
                    return new Date(o.downloadedAt).getTime();
                });
            }

            if (latestMedia && this._showTorrents) {
                // @ts-ignore
                me.latestChange = new Date(latestMedia.uploadedAt).getTime();
            } else if (latestMedia) {
                // @ts-ignore
                me.latestChange = new Date(latestMedia.downloadedAt).getTime();
            }

        }
        return newList;
    }

    private prepareMediaTorrents(metaDataList: MetaData[]): IMetaDataExtended[] {
        if (!metaDataList) {
            return [];
        }
        const newList: IMetaDataExtended[] = [...metaDataList];
        for (const me of newList) {

            // me.poster = me.poster ? `https://image.tmdb.org/t/p/original${me.poster}` : "";
            if (me.poster && !me.poster.startsWith("http")) {
                me.poster = `https://image.tmdb.org/t/p/w300${me.poster}`;
            }
            // check if media is watched
            // if (me.userMetaData.filter(x => x.isWatched && x.userId === this.user.id).length > 0) {
            //     me.isWatched = true;
            // }

            // get latest max date downloaded / changed
            const latestMediaFile: TorrentFile | undefined = _.maxBy(me.torrentFiles, (o) => {
                return o.uploadedAt;
            });
            if (latestMediaFile) {
                me.latestChange = latestMediaFile.uploadedAt;
            }

        }
        return newList;
    }

    private filterMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        // filter watched
        if (this._filterConfig.unwatchedMedia) {
            list = list.filter((m) => !m.isWatched);
        }

        // filter media entries that don't have any files
        if (this._filterConfig.noMediaWithoutFiles) {
            // @ts-ignore
            list = list.filter((m) => !!m.mediaFiles && m.mediaFiles > 0);
        }

        // filter media entries that don't have metaData from imdb
        // if (this._filterConfig.noMediaWithoutMetaData) {
        //     list = list.filter((m) => m.status !== "failed");
        // }

        // filter media by genres
        console.log("noMediaWithoutGenres", this._filterConfig.noMediaWithoutGenres);
        if (this._filterConfig.noMediaWithoutGenres.length > 0) {
            list = list.filter((m) => isStringContains(m.genres, this._filterConfig.noMediaWithoutGenres));
        }
        return list;
    }

    private filterTorrents(list: IMetaDataExtended[]): IMetaDataExtended[] {

        // filter media with files
        // list = list.filter((m) => m.mediaFiles?.length === 0 && m.torrentFiles.length > 0);

        // filter watched
        if (this._filterConfig.unwatchedMedia) {
            list = list.filter((m) => !m.isWatched);
        }

        // filter media entries that don't have meta data from imdb
        if (this._filterConfig.noMediaWithoutMetaData) {
            list = list.filter((m) => m.status !== "failed");
        }

        // filter media by genres
        console.log("noMediaWithoutGenres", this._filterConfig.noMediaWithoutGenres);
        if (this._filterConfig.noMediaWithoutGenres.length > 0) {
            list = list.filter((m) => isStringContains(m.genres, this._filterConfig.noMediaWithoutGenres));
        }
        return list;
    }


    public showTorrents() {
        this._showTorrents = true;
        IpcService.getMedia({
            filter: "all",
            isTorrents: this._showTorrents
        }).then(torrents => {
            this._torrents = torrents;
            this.refreshMedia(this._torrents);
            RoosterX.setFocusToVideos();
        });
        this.closeSideBar();
    }

    public showFolders() {
        this._showTorrents = false;
        IpcService.getMedia({
            filter: "all",
            isTorrents: this._showTorrents
        }).then(media => this.media = media);
        RoosterX.setFocusToVideos();
        this.closeSideBar && this.closeSideBar();
    }

    public getMedia() {
        IpcService.getMedia({
            filter: "all",
            isTorrents: this._showTorrents
        }).then(media => this.media = media);
        RoosterX.setFocusToVideos();
        this.closeSideBar && this.closeSideBar();
    }

    private getMovies() {
        IpcService.getMedia({
            filter: "movies",
            isTorrents: this._showTorrents
        }).then(media => this.media = media);
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    private getSeries() {
        IpcService.getMedia({
            filter: "series",
            isTorrents: this._showTorrents
        }).then(media => this.media = media);
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
        return html`<video-card id="v${v.id}" .video=${v} .rooster=${this}></video-card>`;
    }

    private toggleGroup(e) {
        const toggleWrapper = e.target.closest(".group-header") as HTMLElement;
        const group = toggleWrapper?.nextElementSibling as HTMLElement;
        if (group) {
            toggleWrapper.classList.toggle("open");
            group.classList.toggle("open");
        }
    }

    private getVideoCards() {
        if (!this._filteredMedia) {
            return;
        }

        if (this._filteredMedia instanceof Map) {

            const getGroupTitleFunc = (oc: OrderConfig): (group: string)=>string => {
                if (oc.groupBy === "rating") {
                    return (group) => group ? group : "N/A";
                }
                if (oc.groupBy === "genres") {
                    return (group) => group ? group : "N/A";
                }
                if (oc.groupBy === "uploadedDate") {
                    return (group) => {
                        if (group === "null") {
                            return "N/A";
                        }

                        const title =  group ? fromNow(group) : "N/A";
                        return title;
                    }
                }
                if (oc.groupBy === "downloadedDate") {
                    return (group) => group === "null" ? "N/A" : group ? new Date(group).toLocaleDateString() : "N/A";
                }
                 if (oc.groupBy === "quality") {
                    return (group) => group ? group : "N/A";
                }
                if (oc.groupBy === "resolution") {
                    return (group) => group === "0" ? "N/A" : group ? group + "p" : "N/A";
                }
                if (oc.groupBy === "year") {
                    return (group) => group ? group.toString() || "N/A" : "N/A";
                }
                return (v) => "";
            }

            setTimeout(() => {
                const groupHeaders = document.querySelectorAll(".group-header");
                // add intersection observer for all the sticky group-headers
                // if its above half the screen, add a class to make it z-index: 1
                const observer = new IntersectionObserver((entries) => {
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
                }, {
                    root: null,
                    rootMargin: "0px 0px -200px 0px",
                    threshold: 0.5,
                });
                groupHeaders.forEach(groupHeader => {
                    observer.observe(groupHeader);
                });
            }, 5000);

            // this is a record
            const result: TemplateResult[] = [];
            const getGroupTitle = getGroupTitleFunc(this._orderConfig);
            let index = this._filteredMedia.size;
            for (const [key, arr] of this._filteredMedia) {
                index--;
                result.push(html`
                    <div class="group-header open" style="z-index: ${index}">
                        <div @click="${this.toggleGroup}" class="material-icons mini">keyboard_arrow_down</div>
                        <div @click="${this.toggleGroup}" class="material-icons maxi">chevron_right</div>
                        &nbsp;
                        <a href="#${key}">${getGroupTitle(key)}</a>
                    </div>
                    <div id="${key}" class="group open">
                        <div class="group-videos">
                            ${repeat(arr, (v) => v.id, (v, i) => html`
                                <video-card id="v${v.id}" .video=${v} .rooster=${this}></video-card>`
                )}
                        </div>
                    </div>`);
            }
            return result;
        } else {
            // this is an array
            return (this._filteredMedia as IMetaDataExtended[]).map(v => this.getVideoCard(v));
        }
    }

    public render() {
        return html`
        ${this._sweepStatus ?
            html`<div class="status-wrap">
                <div class="sweep-status">
                    ${this._sweepStatus}
                </div>
            </div>` : ""}
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
        ${this._sideBar ? html`<div class="panel">
            ${this._panel === "filters" ? html`<filters-page .rooster=${this}></filters-page>` : ""}
            ${this._panel === "settings" ? html`<settings-page .rooster=${this}></settings-page>` : ""}
        </div>` : ""}
        <div class="videos" tabindex="0">
            ${this.getVideoCards()}
        </div>`;
    }
}
