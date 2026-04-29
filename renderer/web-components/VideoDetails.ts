import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {VideoCard} from "./VideoCard";
import "./EpisodeCard";
import "./MediaFileCard";
import "./TorrentFileCard";
import "./DidWatched";
import "./AddToList";
import {IEpisodeExtended, IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {type MetaData} from "../entity/MetaData";
import {type Episode} from "../entity/Episode";
import {type MediaFile} from "../entity/MediaFile";
import * as _ from "lodash";

@customElement("video-details")
export class VideoDetails extends LitElement {
    @property() public rooster: RoosterX;
    @property() public video: IMetaDataExtended;
    @property() public card: VideoCard;
    @property() public _episodes: IEpisodeExtended[];
    @property() public _searchResults: any[] = [];
    @property() public searchTitle: string;
    @property() public isLoading: boolean = false;
    @property() public isLoadingRating: boolean = false;
    @property() public isLoadingTrailer: boolean = false;
    @property() public isEnriching: boolean = false;
    @property() public showAddToList: boolean = false;

    public playTimer: any;
    @property() public didYouWatched: null | MetaData | Episode = null;

    // MPV watch progress for the current movie (populated by a poll while
    // this panel is open). Null until the first fetch resolves.
    @property() public watchProgress: null | {
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
    } = null;
    private watchProgressTimer: any = null;

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
            return html``;
        }

        const hr = parseInt((min / 60).toString(), 10);
        min = min - hr * 60;
        let humanTime = "";
        if (hr > 0) humanTime += hr + "h ";
        if (min > 0) humanTime += min + "min";
        if (humanTime) {
            return html`<span class="runtime" title="Runtime">${humanTime.trim()}</span>`;
        }
        return html``;
    }

    public static getYear(vid: MetaData) {
        if (vid.year) {
            return html`<span class="year" title="Year">${vid.year}</span>`;
        } else if (vid.released) {
            const tmp = vid.released.toString().split("-");
            if (tmp.length > 0) {
                return html`<span class="year" title="Released">${tmp[0]}</span>`;
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
        // The grid view ships a slim payload (card-only fields). Fetch the
        // full record now so detail-only fields like plot, actors, tagline,
        // backdrop, trailer, imdbId, runtime, etc. are available. The grid
        // payload only carries: id, title, votes, series, rating, year,
        // poster, released_unix, type, isWatched, mediaFiles, quality,
        // resolution, uploadedAt/Date, downloadedAt/Date, trendingCount,
        // genres.
        IpcService.getMetaDataById({id: this.video.id})
            .then((full: any) => {
                if (!full) return;
                // Merge into the existing reactive video object so card-side
                // state (e.g. mediaFiles count) is preserved.
                Object.assign(this.video, full);
                // Re-apply poster URL prefix that prepareMedia adds for the
                // grid view (the by-id endpoint returns the raw TMDB path).
                if (this.video.poster && !this.video.poster.startsWith("http")) {
                    this.video.poster = `https://image.tmdb.org/t/p/w300${this.video.poster}`;
                }
                if (!this.video.trailer) {
                    this.getYouTubeTrailer();
                }
                if (!this.video.rating) {
                    this.getIMDBRatingVotes();
                }
                this.requestUpdate();
            })
            .catch(err => {
                console.error("Failed to load full metadata for video", this.video.id, err);
                // Fallback: still kick off trailer/rating fetches based on
                // what's already on the slim object.
                if (!this.video.trailer) {
                    this.getYouTubeTrailer();
                }
                if (!this.video.rating) {
                    this.getIMDBRatingVotes();
                }
            });
    }

    public async connectedCallback() {
        super.connectedCallback();
        await this.updateComplete;
        this.mainDetailsEl = document.querySelector(".main-details") as HTMLElement;
        this.mainDetailsEl.focus();
        this.mainDetailsEl.addEventListener("blur", this.setMainDetailsFocus);
        setTimeout(() => {
            this.querySelector(".original-poster")?.classList.add("show");
        }, 1000);
        this.startWatchProgressPoll();
    }

    public disconnectedCallback() {
        this.mainDetailsEl.removeEventListener("blur", this.setMainDetailsFocus);
        this.stopWatchProgressPoll();
        super.disconnectedCallback();
    }

    /**
     * Poll the server every 10s for the current movie's watch progress so the
     * bar stays in sync while mpv is running alongside the renderer.
     * Movies only — series episodes get their own progress UI elsewhere.
     */
    private startWatchProgressPoll() {
        if (!this.video || this.video.type !== "movie") return;
        const fetch = () => {
            IpcService.getWatchProgress("movie", this.video.id)
                .then((wp: any) => {
                    this.watchProgress = wp || null;
                    this.requestUpdate();
                })
                .catch(() => {});
        };
        fetch();
        clearInterval(this.watchProgressTimer);
        this.watchProgressTimer = setInterval(fetch, 10000);
    }

    private stopWatchProgressPoll() {
        if (this.watchProgressTimer) {
            clearInterval(this.watchProgressTimer);
            this.watchProgressTimer = null;
        }
    }

    private renderWatchProgress() {
        if (!this.video || this.video.type !== "movie") return html``;
        // Manual "watched" flag → always show green 100%.
        if (this.video.isWatched) {
            return html`<div class="vd-progress">
                <div class="vd-progress-track">
                    <div class="vd-progress-bar finished" style="width: 100%"></div>
                </div>
                <div class="vd-progress-text">Watched</div>
            </div>`;
        }
        const wp = this.watchProgress;
        if (!wp || !wp.percent || wp.percent <= 0) return html``;
        const pct = Math.min(100, Math.round(wp.percent));
        const finished = !!wp.finished;
        const pos = VideoDetails.formatTime(wp.timePos);
        const dur = VideoDetails.formatTime(wp.duration);
        const label = finished ? "Watched" : `${pct}% · ${pos} / ${dur}`;
        return html`<div class="vd-progress" title="Playback progress">
            <div class="vd-progress-track">
                <div class="vd-progress-bar ${finished ? 'finished' : ''}" style="width: ${pct}%"></div>
            </div>
            <div class="vd-progress-text">${label}</div>
        </div>`;
    }

    private static formatTime(seconds: number): string {
        if (!seconds || seconds <= 0) return "0:00";
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const pad = (n: number) => n.toString().padStart(2, "0");
        return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    }

    private getYouTubeTrailer() {
        this.isLoadingTrailer = true;
        IpcService.getYouTubeTrailer(this.video.id, this.video.title, this.video.year)
            .then(res => {
                if (res) {
                    console.log("trailer", res);
                    this.video.trailer = res as string;
                    this.isLoadingTrailer = false;
                    this.requestUpdate();
                }
            })
            .catch(err => {
                console.log(err);
                this.isLoadingTrailer = false;
            })
    }

    private refreshMetadata = () => {
        if (this.isEnriching) return;
        this.isEnriching = true;
        IpcService.enrichMetadata(this.video.id, true)
            .then((updated: any) => {
                if (updated) {
                    // Server returns raw TMDB paths (e.g. "/abc.jpg"); prefix them
                    // to match the URL form used elsewhere in the renderer.
                    if (updated.poster && !String(updated.poster).startsWith("http")) {
                        updated.poster = `https://image.tmdb.org/t/p/w300${updated.poster}`;
                    }
                    Object.assign(this.video, updated);
                    this.requestUpdate();
                }
            })
            .catch(err => {
                console.log("enrich-metadata failed", err);
            })
            .finally(() => {
                this.isEnriching = false;
            });
    };

    private getIMDBRatingVotes() {
        this.isLoadingRating = true;
        IpcService.getIMDBRating(this.video.id, this.video.imdbId)
            .then(res => {
                if (res) {
                    this.video.rating = (res as {Score: number}).Score;
                    this.video.votes = (res as {Votes: number}).Votes;
                    this.isLoadingRating = false;
                    this.requestUpdate();
                }
            })
            .catch(err => {
                console.log(err);
                this.isLoadingRating = false;
            })
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
                })
                .catch(console.log);
        } else if (this.video.type === "series") {
            console.log("reloadVideo", this.video);
            // @ts-ignore
            IpcService.getEpisodes({metaDataId: this.video.id})
                .then(res => {
                    this.video.episodes = res;
                    this.episodes = res;
                    this.requestUpdate();
                })
                .catch(console.log);
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
            // Tag the MPV session so the rooster-progress.lua script can
            // report watch progress back to the server with a stable id.
            let roosterId: string | undefined;
            if (this.video?.type === "movie") {
                roosterId = `movie-${this.video.id}`;
            } else if (this.video?.type === "series" && this._episodes) {
                const ep = this._episodes.find(e =>
                    e.mediaFiles?.some(mf => mf.id === mediaFile.id),
                );
                if (ep) {
                    roosterId = `episode-${ep.id}`;
                }
            }
            IpcService.openInMPV(mediaFile.path, roosterId);
            clearTimeout(this.playTimer);
            this.playTimer = setTimeout(() => {
                console.log("did you watched? " + mediaFile.raw, mediaFile);
                this.didYouWatched = null;
                IpcService.getMetaDataByFileId({id: mediaFile.id})
                    .then((metaData: MetaData | Episode) => {
                        if (metaData) {
                            console.log(`metaData from mediaFile`, metaData);
                            this.didYouWatched = metaData;
                            this.requestUpdate();
                        }
                    })
                    .catch(console.log);
            }, 3000);
        }
    }

    public openImdbLink() {
        IpcService.openExternal(`https://www.imdb.com/title/${this.video.imdbId}/`);
    }

    public trailerSearch() {
        IpcService.openExternal(
            `https://www.youtube.com/results?search_query=${this.video.title}+trailer+${this.video.year}`,
        );
    }

    public subsSearch() {
        if (this.video.type === "series") {
            const eps = _.filter(this._episodes, o => o.mediaFiles?.length > 0);
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            IpcService.openExternal(
                `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-` +
                    `${this.video.title}` +
                    `+${VideoDetails.getSeriesStringFromEpisode(episodeMax)}`,
            );
        } else {
            IpcService.openExternal(
                `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-` +
                    `${this.video.title}+${this.video.year}`,
            );
        }
    }

    public static getSeriesStringFromEpisode(ep: IEpisodeExtended | undefined, add: number = 0) {
        let se = "";
        if (ep && ep.season && ep.episode) {
            se = "+S" + ep.season.toString().padStart(2, "0") + "E" + (ep.episode + add).toString().padStart(2, "0");
        }
        return se;
    }

    public torrentSearch() {
        let sLink = "https://1337x.to/sort-category-search/";
        const title = this.video.title.replace(" ", "+");
        if (this.video.type === "series") {
            // get latest episode
            const eps = _.filter(this._episodes, o => o.mediaFiles?.length > 0);
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            const se = VideoDetails.getSeriesStringFromEpisode(episodeMax, 1);
            sLink += `${title}${se}/TV/seeders/desc/1/`;
        } else {
            // movie
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

    private onSelectSearchOption(m: any) {
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

    private static parseNetworks(raw?: string | null): {name: string; logo?: string}[] {
        if (!raw) return [];
        const s = raw.toString().trim();
        if (!s) return [];
        if (s.startsWith("[")) {
            try {
                const arr = JSON.parse(s);
                if (Array.isArray(arr)) {
                    return arr
                        .map(x => ({name: (x?.name || "").toString(), logo: x?.logo || ""}))
                        .filter(x => x.name);
                }
            } catch {
                // fall through to plain-text path
            }
        }
        // Legacy plain comma-separated names
        return s
            .split(",")
            .map(n => ({name: n.trim()}))
            .filter(x => x.name);
    }

    private static getNetworkField(label: string, raw?: string | null) {
        const items = VideoDetails.parseNetworks(raw).filter(it => it.logo);
        if (items.length === 0) return html``;
        return html`<span class="md-field network-field" title="${label}">
            ${items.map(
                it => html`<span class="network-item" title="${it.name}">
                    <img
                        class="network-logo"
                        src="https://image.tmdb.org/t/p/w92${it.logo}"
                        alt="${it.name}"
                        loading="lazy" />
                </span>`,
            )}
        </span>`;
    }

    public render() {
        return html` <did-watched
                .rooster=${this.rooster}
                .videoDetails=${this}
                .didYouWatched=${this.didYouWatched}></did-watched>
            <div class="video-details">
                <div class="aside">
                    <div class="close" @click="${this.close}"> <i class="material-icons">arrow_back</i> BACK </div>
                    ${this.isLoading
                        ? html` <div class="isLoading">
                              <i class="material-icons rotate-center">sync</i>
                          </div>`
                        : ``}
                    <div class="poster ${this.video.isWatched ? "watched" : ""}">
                        <div class="filter"></div>
                        <div
                            class="watch-btn"
                            @click=${this.setWatch}
                            ?checked=${this.video.isWatched}
                            title="${this.video.isWatched ? `Set Unwatched` : `Set Watched`}"></div>
                        ${this.video.poster
                            ? html`<img
                                      src="${this.video.poster}"
                                      alt="${this.video.title}"
                                      class="video-poster-card-trans" />
                                  <img
                                      src="${this.video.poster.replace("/w300/", "/original/")}"
                                      alt="${this.video.title}"
                                      class="original-poster" />`
                            : html` <div class="img-missing"><span>${this.video.title}</span></div>`}
                    </div>
                    <div class="score">
                        <span class="rating">${this.video.rating}</span>
                        <span class="votes">
                            ${this.formatNumber(this.video.votes)}
                            <small>/ votes </small>
                            &nbsp <i class="material-icons ${this.isLoadingRating ? 'rotate-center' : ''}" @click="${this.getIMDBRatingVotes}">refresh</i>
                        </span>
                    </div>

                    <div class="torrent-search" @click=${this.torrentSearch}>1337x</div>
                    <div class="subs" @click=${this.subsSearch}>Subs</div>
                </div>
                <div
                    class="main-details"
                    tabindex="0">
                    <div class="header">
                        <div class="left">
                            <h1>
                                ${this.video.title}
                                <i
                                    class="material-icons refresh-meta ${this.isEnriching ? "rotate-center" : ""}"
                                    title="Refresh metadata from TMDB"
                                    @click="${this.refreshMetadata}">cloud_download</i>
                            </h1>
                            ${this.video.tagline
                                ? html`<p class="tagline"><em>“${this.video.tagline}”</em></p>`
                                : ""}
                            <p>${this.video.plot}</p>
                            <div class="small-details">
                                ${this.video.ageRating
                                    ? html`<span class="age-rating-chip" title="Age rating">${this.video.ageRating}</span>`
                                    : ""}
                                ${this.video.genres
                                    ? html`<span class="genres" title="Genres">${this.video.genres
                                          .split(",")
                                          .map(g => g.trim())
                                          .filter(Boolean)
                                          .join(", ")}</span>`
                                    : ""}
                                ${VideoDetails.getRuntime(this.video)}
                                ${VideoDetails.getYear(this.video)}
                                ${VideoDetails.getNetworkField(
                                    this.video.type === "series" ? "Network" : "Studio",
                                    this.video.network,
                                )}
                            </div>
                            ${this.renderWatchProgress()}
                        </div>
                        <div class="trailer"
                            >${this.video.trailer
                                ? html`
                                      <iframe
                                          width="560"
                                          height="315"
                                          src="${this.video.trailer.replace(
                                              ".com/watch?v=",
                                              ".com/embed/",
                                          )}?autoplay=1&mute=1&rel=0"
                                          frameborder="0"
                                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                          allowfullscreen></iframe>
                                  `
                                : ""}<i class="material-icons ${this.isLoadingTrailer ? 'rotate-center' : ''}" @click="${this.getYouTubeTrailer}">refresh</i>
                        </div>
                    </div>

                    ${this.video.type === "series" && this._episodes && this._episodes.length > 0
                        ? html` <div class="episodes">
                              ${this._episodes.map(ep => {
                                  return html` <episode-card
                                      @playMedia=${this.playMedia}
                                      .episode=${ep}
                                      .videoDetails=${this}>
                                  </episode-card>`;
                              })}
                          </div>`
                        : ""}
                    ${this.video.type === "movie" && this.video.mediaFiles && this.video.mediaFiles.length > 0
                        ? html` <div class="media-files">
                              ${this.video.mediaFiles.map(mf => {
                                  return html` <media-file-card @playMedia=${this.playMedia} .mediaFile=${mf}>
                                  </media-file-card>`;
                              })}
                          </div>`
                        : ""}
                    ${this.video.type === "movie" && this.video.torrentFiles && this.video.torrentFiles.length > 0
                        ? html` <div class="media-files">
                              ${this.video.torrentFiles.map(mf => {
                                  return html` <torrent-file-card .torrentFile=${mf}> </torrent-file-card>`;
                              })}
                          </div>`
                        : ""}
                    <br /><br />
                    <div class="info-grid"
                        style="display: grid;
                               grid-template-columns: max-content 1fr;
                               column-gap: 24px;
                               row-gap: 10px;
                               align-items: baseline;
                               max-width: 1100px;
                               margin: 0 0 16px;
                               padding: 16px 20px;
                               border-radius: 8px;
                               background: rgba(255,255,255,0.04);
                               border: 1px solid rgba(255,255,255,0.08);
                               font-size: 15px;">
                        ${this.video.director
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Director</span>
                                   <span>${this.video.director}</span>`
                            : ""}
                        ${this.video.productionStatus
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Status</span>
                                   <span>${this.video.productionStatus}</span>`
                            : ""}
                        ${this.video.country
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Country</span>
                                   <span>${this.video.country}</span>`
                            : ""}
                        ${this.video.released
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Released</span>
                                   <span>${this.video.released}</span>`
                            : ""}
                        ${this.video.languages
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Languages</span>
                                   <span>${this.video.languages}</span>`
                            : ""}
                        ${this.video.actors
                            ? html`<span style="opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-size: 12px;">Cast</span>
                                   <span title="${this.video.actors}" style="line-height: 1.5;">${this.video.actors.split(",").slice(0, 8).join(", ")}${this.video.actors.split(",").length > 8 ? "…" : ""}</span>`
                            : ""}
                    </div>
                    <br />

                    ${this.video.imdbId ? html` <div class="imdb" @click=${this.openImdbLink}>IMDb</div>` : ""}
                    <div class="trailer" @click=${this.trailerSearch}>Trailer</div>
                    <div class="add-to-list-btn" @click=${() => (this.showAddToList = true)}>
                        <i class="material-icons">playlist_add</i> Add to list
                    </div>

                    ${this.showAddToList
                        ? html`<add-to-list
                              .rooster=${this.rooster}
                              .metaDataId=${this.video.id}
                              .onClose=${() => (this.showAddToList = false)}></add-to-list>`
                        : ""}

                    ${!this.rooster.user.isAdmin
                        ? html`<br /><br />
                              <input
                                  type="text"
                                  style="font-size: 26px;"
                                  @input=${e => (this.searchTitle = e.target.value)}
                                  @keypress=${this.searchKeyPress}
                                  value="${this.video.title}" />
                              <button @click="${this.reSearch}" style="font-size: 26px; cursor: pointer;">
                                  Research video in internet database
                              </button>`
                        : ""}
                    ${this.rooster.user.isAdmin
                        ? this._searchResults.map(
                              m =>
                                  html` <div class="searchResultDiv" @click=${() => this.onSelectSearchOption(m)}>
                                      <div class="title">${m.Title} | ${m.Year} | ${m.Type}</div>
                                      <div class="poster">
                                          <img src="${m.Poster}" alt="${m.Title}" />
                                      </div>
                                  </div>`,
                          )
                        : ""}
                </div>
            </div>`;
    }
}
