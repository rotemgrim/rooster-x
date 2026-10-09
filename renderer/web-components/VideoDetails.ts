import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {type IMediaFiles, IpcService} from "../services/ipc.service";
import {formatClock} from "../common/commonUtils";
import {isPhone} from "../common/layout";
import "./EpisodeCard";
import "./MediaFileCard";
import "./TorrentFileCard";
import "./DidWatched";
import "./AddToList";
import {mediaFileSource, playOnDevice} from "./RemotePlayPicker";
import {IEpisodeExtended, IMetaDataExtended} from "../common/models/IMetaDataExtended";
import {RoosterX} from "./RoosterX";
import {type MetaData} from "../entity/MetaData";
import {type Episode} from "../entity/Episode";
import {type MediaFile} from "../entity/MediaFile";
import {type IFileMetaData} from "../common/models/IFileMetaData";
import {posterUrl} from "../common/library";
import * as _ from "lodash";

@customElement("video-details")
export class VideoDetails extends LitElement {
    @property() public rooster: RoosterX;
    @property() public video: IMetaDataExtended;
    @property() public _episodes: IEpisodeExtended[];
    @property() public isLoading: boolean = false;
    @property() public isLoadingRating: boolean = false;
    @property() public isLoadingTrailer: boolean = false;
    @property() public isEnriching: boolean = false;
    @property() public showAddToList: boolean = false;

    public playTimer: any;
    @property() public didYouWatched: null | IFileMetaData = null;

    // MPV watch progress for the current movie (populated by a poll while
    // this panel is open). Null until the first fetch resolves.
    @property() public watchProgress: null | {
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
    } = null;
    private watchProgressTimer: any = null;

    // Watch-progress map for the current series' episodes, keyed by episode id.
    // Refreshed in bulk every 10s instead of per-card so we issue exactly one
    // request per series rather than N (one per episode).
    @property() public episodesWatchProgress: Record<number, {
        percent: number;
        timePos: number;
        duration: number;
        finished: boolean;
    }> = {};
    private episodesWatchProgressTimer: any = null;

    private mainDetailsEl: HTMLElement;

    public createRenderRoot() {
        return this;
    }

    public static getRuntime(vid: Pick<MetaData, "runtime">) {
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

    public static getYear(vid: Pick<MetaData, "year" | "released">) {
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
        this.rooster.closeCard();
    }

    protected firstUpdated(): void {
        this.reloadVideo();
        console.log("firstUpdateed", this.video);
        // The grid view ships a slim payload (card-only fields). Fetch the
        // full record now so detail-only fields like plot, actors, tagline,
        // backdrop, trailer, imdbId, runtime, etc. are available. The grid
        // payload only carries: id, title, votes, series, rating, year,
        // poster, released_unix, type, isWatched, mediaFileCount, quality,
        // resolution, uploadedAt/Date, downloadedAt/Date, trendingCount,
        // genres.
        IpcService.getMetaDataById({id: this.video.id})
            .then(full => {
                if (!full) return;
                // Merge into the existing reactive video object so card-side
                // state (e.g. mediaFileCount) is preserved.
                Object.assign(this.video, full);
                // Re-apply the poster URL the grid uses (the by-id endpoint
                // returns the raw TMDB path).
                if (this.video.poster) {
                    this.video.poster = posterUrl(this.video.poster);
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
        this.stopEpisodesWatchProgressPoll();
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

    /**
     * Poll the server every 10s for ALL of this series' episodes' watch
     * progress in one bulk request, instead of having each EpisodeCard
     * fetch its own row separately. Reduces N requests/10s → 1 request/10s.
     */
    private startEpisodesWatchProgressPoll() {
        this.stopEpisodesWatchProgressPoll();
        if (!this.video || this.video.type !== "series") return;
        if (!this._episodes || this._episodes.length === 0) return;
        const ids = this._episodes.map(e => e.id).filter(Boolean) as number[];
        if (ids.length === 0) return;

        const fetch = () => {
            IpcService.getWatchProgressBulk("episode", ids)
                .then((map: any) => {
                    const next: Record<number, any> = {};
                    if (map) {
                        for (const k of Object.keys(map)) {
                            const n = Number(k);
                            if (!isNaN(n)) next[n] = map[k];
                        }
                    }
                    this.episodesWatchProgress = next;
                    this.requestUpdate();
                })
                .catch(() => {});
        };
        fetch();
        this.episodesWatchProgressTimer = setInterval(fetch, 10000);
    }

    private stopEpisodesWatchProgressPoll() {
        if (this.episodesWatchProgressTimer) {
            clearInterval(this.episodesWatchProgressTimer);
            this.episodesWatchProgressTimer = null;
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
        const pos = formatClock(wp.timePos);
        const dur = formatClock(wp.duration);
        const label = finished ? "Watched" : `${pct}% · ${pos} / ${dur}`;
        return html`<div class="vd-progress" title="Playback progress">
            <div class="vd-progress-track">
                <div class="vd-progress-bar ${finished ? 'finished' : ''}" style="width: ${pct}%"></div>
            </div>
            <div class="vd-progress-text">${label}</div>
        </div>`;
    }

    private getYouTubeTrailer() {
        this.isLoadingTrailer = true;
        IpcService.getYouTubeTrailer(this.video.id, this.video.title, this.video.year)
            .then(res => {
                if (res) {
                    console.log("trailer", res);
                    this.video.trailer = res;
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
            .then(updated => {
                if (updated) {
                    // Server returns raw TMDB paths (e.g. "/abc.jpg").
                    if (updated.poster) {
                        updated.poster = posterUrl(updated.poster);
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
                    this.video.rating = res.Score;
                    this.video.votes = res.Votes;
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
        // shown with the stored peer counts first, then again once stale ones are refreshed
        if (this.video.type === "movie") {
            const show = (res: IMediaFiles) => {
                this.video.torrentFiles = res.torrentFiles;
                this.video.mediaFiles = res.mediaFiles;
                this.requestUpdate();
            };
            IpcService.getMediaFilesByMetaDataId({metaDataId: this.video.id}, show)
                .then(show)
                .catch(console.log);
        } else if (this.video.type === "series") {
            console.log("reloadVideo", this.video);
            const show = (res: IEpisodeExtended[]) => {
                this.video.episodes = res;
                this.episodes = res;
                this.requestUpdate();
            };
            IpcService.getEpisodes({metaDataId: this.video.id}, show)
                .then(show)
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
        const sameEpisodes = _.isEqual(_.map(this._episodes, "id"), _.map(newList, "id"));
        this._episodes = newList;
        console.log("episodes", this._episodes);
        this.requestUpdate();
        // The bulk watch-progress poll follows the episode ids, so the same
        // episodes again (e.g. with refreshed peer counts) keep the running one.
        if (!sameEpisodes) {
            this.startEpisodesWatchProgressPoll();
        }
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
            .then(() => this.showWatched(isWatched))
            .catch(console.log);
    }

    /** Shows the title's watched state as the server now has it, here and in the library. */
    public showWatched(watched: boolean) {
        this.rooster.setItemWatched(this.video, watched);
        this.requestUpdate();
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
            playOnDevice(mediaFileSource(mediaFile), () => IpcService.openInMPV(mediaFile.path, roosterId));
            clearTimeout(this.playTimer);
            this.playTimer = setTimeout(() => {
                console.log("did you watched? " + mediaFile.raw, mediaFile);
                this.didYouWatched = null;
                IpcService.getMetaDataByFileId({id: mediaFile.id})
                    .then(metaData => {
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

    /** The "Mark as watched?" answer for what was just played. */
    private answerDidYouWatched(watched: boolean) {
        const played = this.didYouWatched;
        this.didYouWatched = null;
        if (!watched || !played) {
            return;
        }
        const type = played.episode ? "Episode" : "MetaData";
        IpcService.setWatched({type, entityId: played.id, isWatched: true})
            .then(({isSeriesWatched}) => {
                if (type === "Episode") {
                    const episode = this._episodes?.find(e => e.id === played.id);
                    if (episode) {
                        episode.isWatched = true;
                        this.reloadVideo();
                    }
                }
                if (type === "MetaData" || isSeriesWatched) {
                    this.showWatched(true);
                }
            })
            .catch(err => console.log("could not set watched", err));
    }

    // Web links open in a browser tab directly from the client instead of
    // going through the server's open-external handler.
    private static openInNewTab(url: string) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    public openImdbLink() {
        VideoDetails.openInNewTab(`https://www.imdb.com/title/${this.video.imdbId}/`);
    }

    public trailerSearch() {
        VideoDetails.openInNewTab(
            `https://www.youtube.com/results?search_query=${this.video.title}+trailer+${this.video.year}`,
        );
    }

    public subsSearch() {
        if (this.video.type === "series") {
            const eps = _.filter(this._episodes, o => o.mediaFiles?.length > 0);
            const episodeMax = _.maxBy(eps, ["season", "episode"]);
            VideoDetails.openInNewTab(
                `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-` +
                    `${this.video.title}` +
                    `+${VideoDetails.getSeriesStringFromEpisode(episodeMax)}`,
            );
        } else {
            VideoDetails.openInNewTab(
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
        const title = this.video.title.replace(/ /g, "+");
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
        VideoDetails.openInNewTab(sLink);
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

    /**
     * Map a content rating code (MPAA film, US TV, BBFC, FSK, PEGI, etc.) to
     * a short human-readable tooltip describing who can watch.
     */
    public static getAgeRatingTooltip(rating?: string | null): string {
        if (!rating) return "Age rating";
        const r = rating.toString().trim().toUpperCase();
        const map: Record<string, string> = {
            // MPAA (US film)
            "G": "G — General audiences. All ages admitted.",
            "PG": "PG — Parental guidance suggested. Some material may not be suitable for children.",
            "PG-13": "PG-13 — Parents strongly cautioned. Some material may be inappropriate for children under 13.",
            "R": "R — Restricted. Under 17 requires accompanying parent or adult guardian.",
            "NC-17": "NC-17 — No one 17 and under admitted.",
            "NR": "NR — Not rated.",
            "UR": "UR — Unrated.",
            // US TV
            "TV-Y": "TV-Y — Suitable for all children.",
            "TV-Y7": "TV-Y7 — Directed to children 7 and older.",
            "TV-Y7-FV": "TV-Y7-FV — Children 7+. Contains fantasy violence.",
            "TV-G": "TV-G — Suitable for general audiences. All ages.",
            "TV-PG": "TV-PG — Parental guidance suggested.",
            "TV-14": "TV-14 — May be unsuitable for children under 14.",
            "TV-MA": "TV-MA — Mature audiences only. Not suitable for under 17.",
            // BBFC (UK)
            "U": "U — Universal. Suitable for all ages (4+).",
            "12": "12 — Suitable for ages 12 and over.",
            "12A": "12A — Ages 12+; under 12 only with adult.",
            "15": "15 — Suitable only for ages 15 and over.",
            "18": "18 — Suitable only for adults (18+).",
            // FSK (Germany)
            "FSK 0": "FSK 0 — No age restriction.",
            "FSK 6": "FSK 6 — Ages 6 and over.",
            "FSK 12": "FSK 12 — Ages 12 and over.",
            "FSK 16": "FSK 16 — Ages 16 and over.",
            "FSK 18": "FSK 18 — Adults only (18+).",
            // PEGI / generic numeric
            "PEGI 3": "PEGI 3 — Suitable for all ages (3+).",
            "PEGI 7": "PEGI 7 — Ages 7 and over.",
            "PEGI 12": "PEGI 12 — Ages 12 and over.",
            "PEGI 16": "PEGI 16 — Ages 16 and over.",
            "PEGI 18": "PEGI 18 — Adults only (18+).",
        };
        if (map[r]) return map[r];

        // Fallback: bare numeric like "7", "13", "16" → "Ages N and over."
        const num = r.match(/^(\d{1,2})\+?$/);
        if (num) return `Ages ${num[1]} and over.`;

        return `Age rating: ${rating}`;
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
        return html` <did-watched .prompt=${this.didYouWatched}
                @answer=${(e: CustomEvent<boolean>) => this.answerDidYouWatched(e.detail)}></did-watched>
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
                                      src="${this.video.poster.replace("/w300/", isPhone() ? "/w780/" : "/original/")}"
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
                    <div class="subs" style="font-size: 2.2em; gap: 0.4rem;" @click=${() => (this.showAddToList = true)}>
                        <i class="material-icons" style="font-size: 1.2em;">playlist_add</i> Add to list
                    </div>
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
                                    ? html`<span class="age-rating-chip" title="${VideoDetails.getAgeRatingTooltip(this.video.ageRating)}">${this.video.ageRating}</span>`
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
                                      .watchProgress=${this.episodesWatchProgress[ep.id] || null}
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

                    ${this.video.imdbId
                        ? html`<div class="add-to-list-btn" @click=${this.openImdbLink}>
                              <i class="material-icons">open_in_new</i> IMDb
                          </div>`
                        : ""}
                    <div class="add-to-list-btn" @click=${this.trailerSearch}>
                        <i class="material-icons">play_circle_outline</i> Trailer
                    </div>
                    <div class="add-to-list-btn" @click=${this.subsSearch}>
                        <i class="material-icons">subtitles</i> Subs
                    </div>

                    ${this.showAddToList
                        ? html`<add-to-list
                              .rooster=${this.rooster}
                              .metaDataId=${this.video.id}
                              .onClose=${() => (this.showAddToList = false)}></add-to-list>`
                        : ""}
                </div>
            </div>`;
    }
}
