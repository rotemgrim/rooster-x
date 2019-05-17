
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./TopBar";
import "./VideoCard";
import "./FiltersPage";
import "./SettingsPage";
import {MetaData} from "../../entity/MetaData";
import {IMetaDataExtended} from "../../common/models/IMetaDataExtended";
import {User} from "../../entity/User";
import {IConfig} from "../../common/models/IConfig";
import {RoosterXWrapper} from "./RoosterXWrapper";
import {List} from "linqts";
import * as _ from "lodash";
import {MediaFile} from "../../entity/MediaFile";
import {isStringContains} from "../../main/helpers/Utils";
import {ipcRenderer} from "electron";
import {TorrentFile} from "../../entity/TorrentFile";

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public _media: MetaData[] = [];
    @property() public _torrents: MetaData[] = [];
    @property() public _filteredMedia: IMetaDataExtended[] = [];
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
    @property() public _orderConfig: any = {
        directionDescending: true,
        orderBy: "latestChange",
        showUnwatchedFirst: false,
    };
    @property() public _sweepStatus: string = "";
    @property() public _sweepCount: string = "";
    @property() public _showTorrents: boolean = false;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this._sideBar = false;
        this._panel = "";
        IpcService.getAllMedia().then(media => this.media = media);
        document.addEventListener("click", <HTMLElement>(e) => {
            if (e && !e.target.closest(".side-bar")
                && !e.target.closest(".top-bar")
                && !e.target.closest(".page")
            ) {
                if (this._sideBar) {
                    this._sideBar = false;
                    RoosterX.setFocusToVideos();
                }
            }
        });

        ipcRenderer.on("sweep-update", (e, data) => {
            // console.log("sweep-update", data);
            this.sweepStatus = data.status;
            this.sweepCount = data.count;
        });

        ipcRenderer.on("refresh-media", (e, data) => {
            IpcService.getAllMedia().then(media => this.media = media);
        });
    }

    set sweepStatus(value) {
        this._sweepStatus = value;
        this.requestUpdate();
    }

    set sweepCount(value) {
        this._sweepCount = value;
        this.requestUpdate();
    }

    set media(data) {
        console.log(data);
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
        if (this._showTorrents) {
            if (data) {
                this._filteredMedia = this.prepareMediaTorrents(data);
            } else {
                this._filteredMedia = this.prepareMediaTorrents(this._media);
            }
            this._filteredMedia = this.filterTorrents(this._filteredMedia);
        } else {
            if (data) {
                this._filteredMedia = this.prepareMedia(data);
            } else {
                this._filteredMedia = this.prepareMedia(this._media);
            }
            this._filteredMedia = this.filterMedia(this._filteredMedia);
        }

        this._filteredMedia = this.sortMedia(this._filteredMedia);
        console.log(this._filteredMedia);
        this.requestUpdate();
    }

    private prepareMedia(metaDataList: MetaData[]): IMetaDataExtended[] {
        const newList: IMetaDataExtended[] = [...metaDataList];
        for (const me of newList) {

            // check if media is watched
            if (me.userMetaData.filter(x => x.isWatched && x.userId === this.user.id).length > 0) {
                me.isWatched = true;
            }

            // get latest max date downloaded / changed
            const latestMediaFile: MediaFile | undefined = _.maxBy(me.mediaFiles, (o) => {
                return new Date(o.downloadedAt).getTime();
            });
            if (latestMediaFile) {
                me.latestChange = new Date(latestMediaFile.downloadedAt).getTime();
            }

        }
        return newList;
    }

    private prepareMediaTorrents(metaDataList: MetaData[]): IMetaDataExtended[] {
        const newList: IMetaDataExtended[] = [...metaDataList];
        for (const me of newList) {

            // check if media is watched
            if (me.userMetaData.filter(x => x.isWatched && x.userId === this.user.id).length > 0) {
                me.isWatched = true;
            }

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

        // filter media entries that dont have any files
        if (this._filterConfig.noMediaWithoutFiles) {
            list = list.filter((m) => m.mediaFiles.length > 0);
        }

        // filter media entries that font have meta data from imdb
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

    private filterTorrents(list: IMetaDataExtended[]): IMetaDataExtended[] {
        // filter media with files
        list = list.filter((m) => m.mediaFiles.length === 0 && m.torrentFiles.length > 0);

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

    private sortMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        const linqList = new List<IMetaDataExtended>([...list]);
        console.log("orderBy", this._orderConfig);
        // static order for torrents
        if (this._showTorrents) {
            linqList.OrderByDescending((x: IMetaDataExtended): any => x.id);
        } else if (this._orderConfig.directionDescending) {
            linqList.OrderByDescending((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        } else {
            linqList.OrderBy((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        }

        let mediaArray = linqList.ToArray();
        if (this._orderConfig.showUnwatchedFirst) {
            mediaArray = _.orderBy(mediaArray, ["isWatched"], ["desc"]);
        }

        return mediaArray;
    }

    public showTorrents() {
        this._showTorrents = true;
        this.refreshMedia(this._media);
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    public showFolders() {
        this._showTorrents = false;
        this.refreshMedia(this._media);
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    public getAllMedia() {
        IpcService.getAllMedia().then(media => this.media = media);
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    private getMovies() {
        IpcService.getAllMovies().then(media => this.media = media);
        RoosterX.setFocusToVideos();
        this.closeSideBar();
    }

    private getSeries() {
        IpcService.getAllSeries().then(media => this.media = media);
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
        this.requestUpdate();
    }

    public toggleSideBar(panel: string = "") {
        if (this._sideBar) {
            this.closeSideBar();
        } else {
            this.openSideBar(panel);
        }
    }

    public render() {
        return html`
        ${this._sweepStatus ? html`<div class="sweep-status">
            ${this._sweepStatus} <span>${this._sweepCount}</span>
        </div>` : ""}
        <top-bar .rooster=${this}></top-bar>
        <div class="side-bar ${this._sideBar ? "open" : ""}">
            <ul>
                <li @click=${this.getAllMedia}><i class="material-icons">video_library</i>All Media</li>
                <li @click=${this.getMovies}><i class="material-icons">movie</i>Movies</li>
                <li @click=${this.getSeries}><i class="material-icons">live_tv</i>Series</li>
                <li @click=${this.showFilters}><i class="material-icons">filter_list</i>Filter</li>
            </ul>
            <ul>
                <li @click=${this.showSettings}><i class="material-icons">settings</i>Settings</li>
            </ul>
        </div>
        ${this._sideBar ? html`<div class="panel">
            ${this._panel === "filters" ? html`<filters-page .rooster=${this}></filters-page>` : ""}
            ${this._panel === "settings" ? html`<settings-page .rooster=${this}></settings-page>` : ""}
        </div>` : ""}
        <div class="videos" tabindex="0">
            ${this._filteredMedia.map(v => html`<video-card .video=${v} .rooster=${this}></video-card>`)}
        </div>`;
    }
}
