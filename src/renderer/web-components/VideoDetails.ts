
import {LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import {MetaData} from "../../entity/MetaData";
import {VideoCard} from "./VideoCard";
import "./EpisodeCard";
import "./MediaFileCard";
import "./TorrentFileCard";
import "./DidWatched";
import {IEpisodeExtended, IMetaDataExtended} from "../../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {Episode} from "../../entity/Episode";
import {MediaFile} from "../../entity/MediaFile";
import * as _ from "lodash";
import {IOmdbSearchEntity} from "../../main/services/IMDBService";

@customElement("video-details")
export class VideoDetails extends LitElement {

    @property() public rooster: RoosterX;
    @property() public video: IMetaDataExtended;
    @property() public card: VideoCard;
    @property() public _episodes: IEpisodeExtended[];
    @property() public _searchResults: IOmdbSearchEntity[] = [];
    @property() public searchTitle: string;

    public playTimer: any;
    @property() public didYouWatched: null | MetaData | Episode = null;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        setTimeout(() => {
            this.focus();
        });
    }

    set searchResults(results) {
        this._searchResults = results;
        this.requestUpdate();
    }

    public static getRuntime(vid: MetaData) {
        let min = vid.runtime; // in minutes
        if (min === 0 || !min) {
            return "";
        }

        const hr = parseInt((min / 60).toString(), 10);
        min = min - (hr * 60);
        const hMin =  min + "min ";
        const hHour = hr + "h ";
        let humanTime = "";
        if (hr > 0) {
            humanTime += hHour;
        }
        if (min > 0) {
            humanTime += hMin;
        }
        if (humanTime) {
            return html`${humanTime} ${VideoDetails.getSep()}`;
        }
        return html``;
    }

    public static getYear(vid: MetaData) {
        if (vid.year) {
            return html`${vid.year} ${VideoDetails.getSep()}`;
        } else if (vid.released) {
            const tmp = (vid.released.toString()).split("-");
            if (tmp.length > 0) {
                return html`${tmp[0]} ${VideoDetails.getSep()}`;
            }
        }
        return html``;
    }

    public close() {
        clearTimeout(this.playTimer);
        this.playTimer = null;
        this.card.isShowDetails = false;
        document.body.style.overflow = "auto";
        RoosterX.setFocusToVideos();
        this.requestUpdate();
    }

    protected firstUpdated(): void {
        this.reloadVideo();
    }

    public reloadVideo() {
        if (this.video.type === "series") {
            // IpcService.dbQuery("Episode", {
            //     where: {
            //         metaDataId: this.video.id,
            //     },
            //     order: {
            //         season: "ASC",
            //         episode: "ASC",
            //     },
            //     cache: true,
            this.searchTitle = this.video.title;
            IpcService.getEpisodes({metaDataId: this.video.id})
                .then(res => {
                    this.video.episodes = res;
                    this.episodes = res;
                    this.requestUpdate();
            }).catch(console.log);
        }
    }

    set episodes(episodes: Episode[]) {
        const userId = this.rooster.user.id;
        let newList: IEpisodeExtended[] = [...episodes];
        for (const e of newList) {
            // check if episode is watched
            if (e.userEpisode.filter(x => x.isWatched && x.userId === userId).length > 0) {
                e.isWatched = true;
            }
        }
        newList = _.orderBy(newList, ["season", "episode"], ["desc", "desc"]);
        this._episodes = newList;
        console.log("episodes", this._episodes);
        this.requestUpdate();
    }

    private formatNumber(num) {
        if (num && typeof num === "number") {
            return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
        } else {
            return "N/A";
        }
    }

    private setWatch(e) {
        let isWatched;
        if (e.target.hasAttribute("checked")) {
            console.log("set unwatched");
            isWatched = false;
        } else {
            console.log("set watched");
            isWatched = true;
        }
        IpcService.setWatched({type: "MetaData", entityId: this.video.id, isWatched})
            .then(() => {
                this.video.isWatched = isWatched;
                this.requestUpdate();
            })
            .catch(console.log);
    }

    public playMedia(e: CustomEvent) {
        if (e && e.detail) {
            const mediaFile: MediaFile = e.detail;
            IpcService.openExternal(mediaFile.path);
            clearTimeout(this.playTimer);
            this.playTimer = setTimeout(() => {
                console.log("did you watched? " + mediaFile.raw, mediaFile);
                // this.didYouWatched = null;
                IpcService.getMetaDataByFileId({id: mediaFile.id})
                    .then((metaData: MetaData|Episode) => {
                        if (metaData) {
                            console.log("metaData", metaData);
                            this.didYouWatched = metaData;
                            this.requestUpdate();
                        }
                    }).catch(console.log);
            }, 3000); // this is 5 min
        }
    }

    public openImdbLink() {
        IpcService.openExternal(`https://www.imdb.com/title/${this.video.imdbId}/`);
    }

    public trailerSearch() {
        IpcService.openExternal(
            `https://www.youtube.com/results?search_query=${this.video.title}+trailer+${this.video.year}`);
    }

    public torrentSearch() {
        let sLink = "https://1337x.to/sort-category-search/";
        const title = this.video.title.replace(" ", "+");
        if (this.video.type === "series") {
            // get latest episode
            const eps = _.filter(this._episodes, (o => o.mediaFiles.length > 0));
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            let se = "";
            if (episodeMax && episodeMax.season && episodeMax.episode) {
                se = "+S" + episodeMax.season.toString().padStart(2, "0") +
                    "E" + (episodeMax.episode + 1).toString().padStart(2, "0");
            }
            sLink += `${title}${se}/TV/seeders/desc/1/`;
        } else { // movie
            sLink += `${title}/Movies/seeders/desc/1/`;
        }
        IpcService.openExternal(sLink);
    }

    public reSearch() {
        IpcService.reSearch(this.searchTitle)
            .then(res => {
                this.searchResults = res;
                console.log(res);
            })
            .catch(console.log);
    }

    private onSelectSearchOption(m: IOmdbSearchEntity) {
        IpcService.updateMetaDataById(m.imdbID, this.video.id)
            .then(res => {
                console.log(res);
                this.video = Object.assign(this.video, res);
                this.requestUpdate();
            })
            .catch(console.log);
    }

    private static getSep() {
        return html`<span class="separator">|</span>`;
    }

    public render() {
        return html`<did-watched .rooster=${this.rooster} .videoDetails=${this}
                .didYouWatched=${this.didYouWatched}></did-watched>
        <div class="video-details">
            <div class="aside">
                <div class="close" @click="${this.close}">
                    <i class="material-icons">arrow_back</i> BACK
                </div>
                <div class="poster ${this.video.isWatched ? "watched" : ""}">
                    <div class="filter"></div>
                    <div class="watch-btn" @click=${this.setWatch}
                        ?checked=${this.video.isWatched}
                        title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                    ${this.video.poster ?
                        html`<img src="${this.video.poster}" alt="${this.video.title}" />` :
                        html`<div class="img-missing"><span>${this.video.title}</span></div>`}

                </div>
                <div class="score">
                    <span class="rating">${this.video.rating}</span>
                    <span class="votes">${this.formatNumber(this.video.votes)} <small>/ votes</small></span>
                </div>
                ${this.video.imdbId ?
                    html`<div class="imdb" @click=${this.openImdbLink}>IMDb</div>` : ""}
                <div class="trailer" @click=${this.trailerSearch}>Trailer</div>
                <div class="torrent-search" @click=${this.torrentSearch}>1337x</div>
            </div>
            <div class="main-details">
                <h1>${this.video.name}</h1>
                <p>${this.video.plot}</p>
                <div class="small-details">
                    <div class="genres">${this.video.genres}</div> ${VideoDetails.getSep()}
                    <div>
                        ${VideoDetails.getRuntime(this.video)}
                        ${VideoDetails.getYear(this.video)}
                        ${this.video.languages}
                    </div>
                </div>
                ${this.video.type === "series" && this._episodes
                    && this._episodes.length > 0 ?
                    html`<div class="episodes">
                        ${this._episodes.map(ep => {
                            return html`<episode-card
                                @playMedia=${this.playMedia}
                                .episode=${ep}
                                .videoDetails=${this}>
                            </episode-card>`;
                        })}
                    </div>` : ""}
                ${this.video.type === "movie" && this.video.mediaFiles
                    && this.video.mediaFiles.length > 0 ?
                    html`<div class="media-files">
                        ${this.video.mediaFiles.map(mf => {
                            return html`<media-file-card
                                @playMedia=${this.playMedia}
                                .mediaFile=${mf}>
                            </media-file-card>`;
                        })}
                    </div>` : ""}
                ${this.video.type === "movie" && this.video.torrentFiles
                    && this.video.torrentFiles.length > 0 ?
                    html`<div class="media-files">
                        ${this.video.torrentFiles.map(mf => {
                            return html`<torrent-file-card
                                .torrentFile=${mf}>
                            </torrent-file-card>`;
                        })}
                    </div>` : ""}
                <br><br>
                <p>Actors: <small>${this.video.actors}</small></p>
                <br><br>
                <p>Made in ${this.video.country}</p>
                <br><br>
                <input type="text" @input=${(e) => this.searchTitle = e.target.value} value="${this.video.title}" />
                <button @click="${this.reSearch}">
                    Research video in internet database
                </button>
                ${this.rooster.user.isAdmin ?
                this._searchResults.map(m => html`<div @click=${() => this.onSelectSearchOption(m)}
                        style="margin-bottom: 2em;">
                    <div class="title">${m.Title} | ${m.Year} | ${m.Type}</div>
                    <div class="poster"><img src="${m.Poster}" alt="${m.Title}"></div>
                </div>`) : ""}
            </div>
        </div>`;
    }
}
