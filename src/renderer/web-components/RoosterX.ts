
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

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public _media: MetaData[] = [];
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
    };
    @property() public _orderConfig: any = {
        directionDescending: true,
        orderBy: "latestChange",
    };

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
    }

    set media(data) {
        console.log(data);
        this._media = data;
        this._filteredMedia = this.prepareMedia(data);
        this._filteredMedia = this.filterMedia(this._filteredMedia);
        this._filteredMedia = this.sortMedia(this._filteredMedia);
        console.log(this._filteredMedia);
        this.requestUpdate();
    }

    set filterConfig(data) {
        this._filterConfig = data;
        this.media = this._media;
    }

    set orderConfig(data) {
        this._orderConfig = data;
        this.media = this._media;
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

    private filterMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        if (this._filterConfig.unwatchedMedia) {
            list = list.filter((m) => !m.isWatched);
        }
        if (this._filterConfig.noMediaWithoutFiles) {
            list = list.filter((m) => m.mediaFiles.length > 0);
        }
        if (this._filterConfig.noMediaWithoutMetaData) {
            list = list.filter((m) => m.status !== "failed");
        }
        return list;
    }

    private sortMedia(list: IMetaDataExtended[]): IMetaDataExtended[] {
        const linqList = new List<IMetaDataExtended>([...list]);
        console.log("orderBy", this._orderConfig);
        if (this._orderConfig.directionDescending) {
            linqList.OrderByDescending((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        } else {
            linqList.OrderBy((x: IMetaDataExtended): any => x[this._orderConfig.orderBy]);
        }
        return linqList.ToArray();
    }

    private getAllMedia() {
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
        <top-bar .rooster="${this}"></top-bar>
        <div class="side-bar ${this._sideBar ? "open" : ""}">
            <ul>
                <li @click="${this.getAllMedia}"><i class="material-icons">video_library</i>All Media</li>
                <li @click="${this.getMovies}"><i class="material-icons">movie</i>Movies</li>
                <li @click="${this.getSeries}"><i class="material-icons">live_tv</i>Series</li>
                <li @click="${this.showFilters}"><i class="material-icons">filter_list</i>Filter</li>
            </ul>
            <ul>
                <li @click="${this.showSettings}"><i class="material-icons">settings</i>Settings</li>
            </ul>
        </div>
        ${this._sideBar ? html`<div class="panel">
            ${this._panel === "filters" ? html`<filters-page .rooster="${this}"></filters-page>` : ""}
            ${this._panel === "settings" ? html`<settings-page .rooster="${this}"></settings-page>` : ""}
        </div>` : ""}
        <div class="videos" tabindex="0">
            ${this._filteredMedia.map(v => html`<video-card .video=${v}></video-card>`)}
        </div>`;
    }
}
