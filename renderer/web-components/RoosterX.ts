
import {LitElement, html, TemplateResult} from "lit";
import {customElement, property} from "lit/decorators.js";
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
    @property() public _filteredMedia: IMetaDataExtended[] | Record<string, IMetaDataExtended[]> = [];
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
        orderBy: "latestChange",
        groupBy: "none",
        showUnwatchedFirst: false,
    };
    @property() public _sweepStatus: string = "";
    @property() public _sweepCount: string = "";
    @property() public _showTorrents: boolean = false;
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

        this._filteredMedia = this.sortMedia(this._filteredMedia);
        console.log("sorted:", this._filteredMedia);
        this.requestUpdate();
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

    private sortMedia(list: IMetaDataExtended[]): IMetaDataExtended[] | Record<string, IMetaDataExtended[]> {
        const linqList = new List<IMetaDataExtended>([...list]);
        let newList: List<IMetaDataExtended>;
        console.log("orderBy", this._orderConfig);
        // static order for torrents
        // if (this._showTorrents) {
        //     newList = linqList.OrderByDescending((x: IMetaDataExtended): any => x.id);
        // } else
        if (this._orderConfig.directionDescending) {
            newList = linqList.OrderByDescending((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        } else {
            newList = linqList.OrderBy((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        }

        let mediaArray = newList.ToArray();
        let result;
        if (this._orderConfig.showUnwatchedFirst) {
            mediaArray = _.orderBy(mediaArray, ["isWatched"], ["desc"]);
        }
        result = mediaArray;

        // group by
        if (this._orderConfig.groupBy && this._orderConfig.groupBy !== "none") {
            const linqList = new List<IMetaDataExtended>([...mediaArray]);
            const grouped = linqList.GroupBy((x: IMetaDataExtended) => x[this._orderConfig.groupBy]) as Record<string, IMetaDataExtended[]>;
            result = grouped;
            // if (this._orderConfig.directionDescending) {
            //     // reverse group order
            //     // result = grouped.reverse();
            // }
            // console.log("grouped", result);
            // for (const group of grouped) {
            //     mediaArray.push({title: group.Key(), isGroup: true});
            //     mediaArray = mediaArray.concat(group.ToArray());
            // }
        }

        return result;
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

    private getVideoCards() {
        if (!this._filteredMedia) {
            return;
        }

        if (!this._filteredMedia.length) {

            const getGroupTitleFunc = (oc: OrderConfig): (group: string)=>string => {
                // if (this._orderConfig.groupBy === "genres") {
                //     return (v) => v.genres;
                // }
                if (this._orderConfig.groupBy === "uploadedDate") {
                    return (group) => group ? group : "N/A";
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

            // this is a record
            const result: TemplateResult[] = [];
            const keys = Object.keys(this._filteredMedia);
            const getGroupTitle = getGroupTitleFunc(this._orderConfig);
            for (let i = keys.length - 1; i >= 0; i--) {
                const key = keys[i];
                console.log("key", key);
                result.push(html`<div class="group">
                    <h2>${getGroupTitle(key)}</h2>
                    <div class="group-videos">
                        ${this._filteredMedia[key].map(v => 
                            html`<video-card id="v${v.id}" .video=${v} .rooster=${this}></video-card>`)}
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
