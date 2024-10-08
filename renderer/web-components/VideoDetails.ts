
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {VideoCard} from "./VideoCard";
import "./EpisodeCard";
import "./MediaFileCard";
import "./TorrentFileCard";
import "./DidWatched";
import {IEpisodeExtended, IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {type MetaData} from "../entity/MetaData";
import {type Episode} from "../entity/Episode";
import {type MediaFile} from "../entity/MediaFile";
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
    @property() public isLoading: boolean = false;

    public playTimer: any;
    @property() public didYouWatched: null | MetaData | Episode = null;

    private mainDetailsEl: HTMLElement;

    public createRenderRoot() {
        return this;
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
        this.card.closeDetails();
    }

    protected firstUpdated(): void {
        this.reloadVideo();
        console.log("firstUpdateed", this.video);
        if (!this.video.trailer) {
            IpcService.getYouTubeTrailer(this.video.id, this.video.title, this.video.year)
                .then((res) => {
                    if (res) {
                        console.log("trailer", res);
                        this.video.trailer = res as string;
                        this.requestUpdate();
                    }
                }
            ).catch(console.log);
        }
        if (!this.video.rating) {
            this.getIMDBRatingVotes();
        }
    }

    public async connectedCallback() {
        super.connectedCallback();
        await this.updateComplete;
        this.mainDetailsEl = document.querySelector(".main-details") as HTMLElement;
        this.mainDetailsEl.focus();
        this.mainDetailsEl.addEventListener("blur", this.setMainDetailsFocus);
        setTimeout(() => {
            this.querySelector(".original-poster")?.classList.add("show");
        }, 1000)
    }

    public disconnectedCallback() {
        this.mainDetailsEl.removeEventListener("blur", this.setMainDetailsFocus);
        super.disconnectedCallback();
    }

    private getIMDBRatingVotes() {
        IpcService.getIMDBRating(this.video.id, this.video.imdbId)
            .then((res) => {
                    if (res) {
                        this.video.rating = (res as {Score: number}).Score;
                        this.video.votes = (res as {Votes: number}).Votes;
                        this.requestUpdate();
                    }
                }
            ).catch(console.log);
    }

    private setMainDetailsFocus(event) {
        setTimeout(() => {
            if (!event.relatedTarget || !event.relatedTarget.closest(".main-details")) {
                console.debug("set focus to main details div", event);
                const tmp = document.querySelector(".main-details") as HTMLElement;
                if (tmp) {
                    tmp.focus();
                }
            } else {
                console.debug("skip set focus", event);
            }
        });
    }

    public reloadVideo() {
        this.searchTitle = this.video.title;
        if (this.video.type === "movie") {
            IpcService.getMediaFilesByMetaDataId({metaDataId: this.video.id})
                .then(res => {
                    this.video.torrentFiles = res.torrentFiles;
                    this.video.mediaFiles = res.mediaFiles;
                    this.requestUpdate();
                }).catch(console.log);
        } else if (this.video.type === "series") {
            console.log("reloadVideo", this.video);
            // @ts-ignore
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
        // for (const e of newList) {
        //     // check if episode is watched
        //     if (e.userEpisode?.filter(x => x.isWatched && x.userId === 1).length > 0) {
        //         // @ts-ignore
        //         e.episode.isWatched = true;
        //     } else {
        //         // @ts-ignore
        //         e.episode.isWatched = false;
        //     }
        // }
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
            this.isLoading = true;
            setTimeout(() => {
                this.isLoading = false;
            }, 3000);
            const mediaFile: MediaFile = e.detail;
            IpcService.openExternal(mediaFile.path);
            clearTimeout(this.playTimer);
            this.playTimer = setTimeout(() => {
                console.log("did you watched? " + mediaFile.raw, mediaFile);
                this.didYouWatched = null;
                IpcService.getMetaDataByFileId({id: mediaFile.id})
                    .then((metaData: MetaData|Episode) => {
                        if (metaData) {
                            console.log(`metaData from mediaFile`, metaData);
                            this.didYouWatched = metaData;
                            this.requestUpdate();
                        }
                    }).catch(console.log);
            }, 3000);
        }
    }

    public openImdbLink() {
        IpcService.openExternal(`https://www.imdb.com/title/${this.video.imdbId}/`);
    }

    public trailerSearch() {
        IpcService.openExternal(
            `https://www.youtube.com/results?search_query=${this.video.title}+trailer+${this.video.year}`);
    }

    public subsSearch() {
        if (this.video.type === "series") {
            const eps = _.filter(this._episodes, (o => o.mediaFiles?.length > 0));
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            IpcService.openExternal(
                `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-`
                + `${this.video.title}`
                + `+${VideoDetails.getSeriesStringFromEpisode(episodeMax)}`);
        } else {
            IpcService.openExternal(
                `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-`
                + `${this.video.title}+${this.video.year}`);
        }
    }

    public static getSeriesStringFromEpisode(ep: IEpisodeExtended|undefined, add: number = 0) {
        let se = "";
        if (ep && ep.season && ep.episode) {
            se = "+S" + ep.season.toString().padStart(2, "0") +
                "E" + (ep.episode + add).toString().padStart(2, "0");
        }
        return se;
    }

    public torrentSearch() {
        let sLink = "https://1337x.to/sort-category-search/";
        const title = this.video.title.replace(" ", "+");
        if (this.video.type === "series") {
            // get latest episode
            const eps = _.filter(this._episodes, (o => o.mediaFiles?.length > 0));
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            const se = VideoDetails.getSeriesStringFromEpisode(episodeMax, 1);
            sLink += `${title}${se}/TV/seeders/desc/1/`;
        } else { // movie
            sLink += `${title}/Movies/seeders/desc/1/`;
        }
        IpcService.openExternal(sLink);
    }

    private searchKeyPress(e) {
        if (e.target.value && e.key === "Enter") {
            this.reSearch();
        }
    }

    public reSearch() {
        this.isLoading = true;
        IpcService.reSearch(this.searchTitle)
            .then(res => {
                this.searchResults = res;
                console.log("reSearch results", res);
                this.isLoading = false;
            })
            .catch(e => {
                console.log("reSearch failed", e);
                this.isLoading = false;
            });
    }

    private onSelectSearchOption(m: IOmdbSearchEntity) {
        this.isLoading = true;
        IpcService.updateMetaDataById(m.imdbID, this.video.id)
            .then(res => {
                console.log(res);
                this.video = Object.assign(this.video, res);
                this.isLoading = false;
                this.requestUpdate();
            })
            .catch(e => {
                console.log(e);
                this.isLoading = false;
            });
    }

    private static getSep() {
        return html`<span class="separator">|</span>`;
    }

    public render() {
        return html`
            <did-watched .rooster=${this.rooster} .videoDetails=${this}
                         .didYouWatched=${this.didYouWatched}></did-watched>
            <div class="video-details">
                <div class="aside">
                    <div class="close" @click="${this.close}">
                        <i class="material-icons">arrow_back</i> BACK
                    </div>
                    ${this.isLoading ? html`
                        <div class="isLoading">
                            <i class="material-icons rotate-center">sync</i>
                        </div>` : ``}
                    <div class="poster ${this.video.isWatched ? "watched" : ""}">
                        <div class="filter"></div>
                        <div class="watch-btn" @click=${this.setWatch}
                             ?checked=${this.video.isWatched}
                             title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                        ${this.video.poster ?
                                html`<img src="${this.video.poster}" alt="${this.video.title}"
                                          class="video-poster-card-trans"/>
                                <img src="${this.video.poster.replace("/w300/", "/original/")}"
                                     alt="${this.video.title}" class="original-poster"/>` :
                                html`
                                    <div class="img-missing"><span>${this.video.title}</span></div>`}

                    </div>
                    <div class="score">
                        <span class="rating">${this.video.rating}</span>
                        <span class="votes">
                            ${this.formatNumber(this.video.votes)} 
                            <small>/ votes </small>
                            &nbsp <i class="material-icons" @click="${this.getIMDBRatingVotes}">refresh</i>
                        </span>
                    </div>

                    <div class="torrent-search" @click=${this.torrentSearch}>1337x</div>
                    <div class="subs" @click=${this.subsSearch}>Subs</div>
                </div>
                <div class="main-details" tabindex="0">
                    <div class="header">
                        <div class="left">
                            <h1>${this.video.title}</h1>
                            <p>${this.video.plot}</p>
                            <div class="small-details">
                                <div class="genres">${this.video.genres}</div>
                                ${VideoDetails.getSep()}
                                <div>
                                    ${VideoDetails.getRuntime(this.video)}
                                    ${VideoDetails.getYear(this.video)}
                                    ${this.video.languages}
                                </div>
                            </div>
                        </div>
                        <div class="trailer">${this.video.trailer ?
                                html`
                                    <iframe width="560" height="315"
                                            src="${this.video.trailer.replace(".com/watch?v=", ".com/embed/")}?autoplay=1&mute=1&rel=0"
                                            frameborder="0"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowfullscreen></iframe>
                                ` : ""}
                        </div>
                    </div>

                    ${this.video.type === "series" && this._episodes
                    && this._episodes.length > 0 ?
                            html`
                                <div class="episodes">
                                    ${this._episodes.map(ep => {
                                        return html`
                                            <episode-card
                                                    @playMedia=${this.playMedia}
                                                    .episode=${ep}
                                                    .videoDetails=${this}>
                                            </episode-card>`;
                                    })}
                                </div>` : ""}
                    ${this.video.type === "movie" && this.video.mediaFiles
                    && this.video.mediaFiles.length > 0 ?
                            html`
                                <div class="media-files">
                                    ${this.video.mediaFiles.map(mf => {
                                        return html`
                                            <media-file-card
                                                    @playMedia=${this.playMedia}
                                                    .mediaFile=${mf}>
                                            </media-file-card>`;
                                    })}
                                </div>` : ""}
                    ${this.video.type === "movie" && this.video.torrentFiles
                    && this.video.torrentFiles.length > 0 ?
                            html`
                                <div class="media-files">
                                    ${this.video.torrentFiles.map(mf => {
                                        return html`
                                            <torrent-file-card
                                                    .torrentFile=${mf}>
                                            </torrent-file-card>`;
                                    })}
                                </div>` : ""}
                    <br><br>
                    <p>Actors: <small title="${this.video.actors}">${this.video.actors?.slice(0, 80)}...</small></p>
                    <br>
                    <p>Made in ${this.video.country} | Released at ${this.video.released}</p>
                    <br><br>

                    ${this.video.imdbId ?
                            html`
                                <div class="imdb" @click=${this.openImdbLink}>IMDb</div>` : ""}
                    <div class="trailer" @click=${this.trailerSearch}>Trailer</div>

                    ${!this.rooster.user.isAdmin ? html`<br><br>
                    <input type="text" style="font-size: 26px;"
                           @input=${(e) => this.searchTitle = e.target.value}
                           @keypress=${this.searchKeyPress}
                           value="${this.video.title}"/>
                    <button @click="${this.reSearch}" style="font-size: 26px; cursor: pointer;">
                        Research video in internet database
                    </button>` : ""}
                    ${this.rooster.user.isAdmin ?
                            this._searchResults.map(m =>
                                    html`
                                        <div class="searchResultDiv" @click=${() => this.onSelectSearchOption(m)}>
                                            <div class="title">${m.Title} | ${m.Year} | ${m.Type}</div>
                                            <div class="poster">
                                                <img src="${m.Poster}" alt="${m.Title}">
                                            </div>
                                        </div>`) : ""}
                </div>
            </div>`;
    }
}
