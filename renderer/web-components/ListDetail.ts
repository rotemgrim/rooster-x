import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import Sortable from "sortablejs";
import {IpcService} from "../services/ipc.service";
import {RoosterX} from "./RoosterX";
import {type IListItemRow} from "../common/models/IList";
import {posterUrl} from "../common/library";

interface ListItemRow {
    id: number;
    listId: number;
    metaDataId: number;
    position: number;
    addedAt: number;
    title: string;
    year?: number;
    poster?: string;
    type: "movie" | "series";
    series?: boolean;
    rating?: number;
    isWatched?: boolean;
    episodesTotal: number;
    episodesWatched: number;
    moviePercent?: number;
    movieFinished?: boolean;
}

@customElement("list-detail")
export class ListDetail extends LitElement {
    @property({attribute: false}) public rooster: RoosterX;
    @property({type: Number}) public listId: number;
    // Whether an item's details are open over the list (RoosterX shows them).
    @property({type: Boolean}) public detailsOpen = false;

    @state() private items: ListItemRow[] = [];
    @state() private listName: string = "";
    @state() private isLoading: boolean = false;

    // Sortable.js instance attached to the rows container. Recreated each
    // time the rows container appears in the DOM (it can disappear when
    // the empty-state branch renders, then come back after refresh).
    private sortable: Sortable | null = null;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
    }

    public updated(changed: Map<string, unknown>) {
        // closing an item's details may have changed its watched state
        const detailsClosed = changed.get("detailsOpen") === true && !this.detailsOpen;
        if (changed.has("listId") || detailsClosed) {
            this.refresh();
        }
        this.ensureSortable();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        this.destroySortable();
    }

    /**
     * Idempotently attach Sortable.js to the current `.ld-rows` container.
     * Re-creates the instance if the container element changed (e.g. went
     * empty -> populated). The standard Lit/Sortable conflict is that
     * Sortable mutates the DOM directly while Lit re-renders from the data
     * array. The fix is in `onEnd`: we revert Sortable's DOM move FIRST,
     * then update `this.items`. Lit's next render produces a clean DOM that
     * matches the new data order without double-moves.
     */
    private ensureSortable() {
        const container = this.querySelector<HTMLElement>(".ld-rows");
        if (!container) {
            this.destroySortable();
            return;
        }
        // If we already have a Sortable bound to this exact element, keep it.
        if (this.sortable && (this.sortable as any).el === container) return;
        this.destroySortable();
        this.sortable = Sortable.create(container, {
            animation: 150,
            handle: ".ld-handle",
            ghostClass: "ld-row-ghost",
            chosenClass: "ld-row-chosen",
            dragClass: "ld-row-drag",
            onEnd: evt => this.onSortEnd(evt),
        });
    }

    private destroySortable() {
        if (this.sortable) {
            this.sortable.destroy();
            this.sortable = null;
        }
    }

    private onSortEnd(evt: Sortable.SortableEvent) {
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;

        // Revert Sortable's DOM mutation so Lit can re-render cleanly from
        // the reordered data array. We must REMOVE the moved element first,
        // otherwise children[oldIndex] points at the wrong reference for
        // upward drags (where the moved element shifts other items to the
        // right of its original slot).
        const parent = evt.from as HTMLElement;
        const movedEl = evt.item as HTMLElement;
        parent.removeChild(movedEl);
        const refEl = parent.children[oldIndex] || null;
        parent.insertBefore(movedEl, refEl);

        const next = this.items.slice();
        const [moved] = next.splice(oldIndex, 1);
        next.splice(newIndex, 0, moved);
        this.items = next;

        IpcService.reorderListItems(
            this.listId,
            this.items.map(i => i.metaDataId),
        ).catch(err => {
            console.error("reorder failed", err);
            this.refresh();
        });
    }

    private refresh() {
        this.isLoading = true;
        // Fetch list summary so we can show the name. We piggy-back on
        // get-lists since there's no get-list-by-id route — cheap enough.
        Promise.all([IpcService.getLists(), IpcService.getListItems(this.listId)])
            .then(([lists, items]) => {
                const meta = (lists || []).find(l => l.id === this.listId);
                this.listName = meta?.name || "List";
                this.items = this.sortWatchedLast((items || []).map(this.toRow));
                this.isLoading = false;
            })
            .catch(err => {
                console.error("ListDetail refresh failed", err);
                this.isLoading = false;
            });
    }

    private toRow = (r: IListItemRow): ListItemRow => ({
        id: r.id,
        listId: r.listId,
        metaDataId: r.metaDataId,
        position: r.position,
        addedAt: r.addedAt,
        title: r.title || "",
        year: r.year || undefined,
        poster: r.poster ? posterUrl(r.poster) : undefined,
        type: r.type === "series" ? "series" : "movie",
        series: !!r.series,
        rating: r.rating ?? undefined,
        isWatched: !!r.isWatched,
        episodesTotal: r.episodesTotal || 0,
        episodesWatched: r.episodesWatched || 0,
        moviePercent: r.moviePercent ?? undefined,
        movieFinished: !!r.movieFinished,
    });

    private back() {
        this.rooster.navigate({view: "lists"});
    }

    private async renameList() {
        const name = window.prompt("Rename list:", this.listName);
        if (!name || !name.trim() || name.trim() === this.listName) return;
        try {
            await IpcService.updateList(this.listId, name.trim());
            this.listName = name.trim();
        } catch (err) {
            console.error("rename failed", err);
        }
    }

    private async deleteList() {
        if (!window.confirm(`Delete list "${this.listName}"? This cannot be undone.`)) return;
        try {
            await IpcService.deleteList(this.listId);
            this.rooster.navigate({view: "lists"});
        } catch (err) {
            console.error("delete failed", err);
        }
    }

    private async toggleWatched(e: Event, item: ListItemRow) {
        e.stopPropagation();
        const next = !item.isWatched;
        try {
            await IpcService.setWatched({
                type: "MetaData",
                entityId: item.metaDataId,
                isWatched: next,
            });
            // Optimistic local update + push watched items to the end so
            // the row order reflects the new state. Persist the new
            // ordering so other clients / reloads stay consistent.
            const updated = this.items.map(i =>
                i.metaDataId === item.metaDataId ? {...i, isWatched: next} : i,
            );
            this.items = this.sortWatchedLast(updated);
            IpcService.reorderListItems(
                this.listId,
                this.items.map(i => i.metaDataId),
            ).catch(err => console.error("reorder after watched toggle failed", err));
        } catch (err) {
            console.error("setWatched failed", err);
        }
    }

    /**
     * Stable sort that keeps unwatched items first (preserving their
     * relative order) and pushes watched items to the end.
     */
    private sortWatchedLast(items: ListItemRow[]): ListItemRow[] {
        const unwatched: ListItemRow[] = [];
        const watched: ListItemRow[] = [];
        for (const i of items) {
            (i.isWatched ? watched : unwatched).push(i);
        }
        return [...unwatched, ...watched];
    }

    private async removeItem(e: Event, item: ListItemRow) {
        e.stopPropagation();
        try {
            await IpcService.removeListItem(this.listId, item.metaDataId);
            this.items = this.items.filter(i => i.metaDataId !== item.metaDataId);
        } catch (err) {
            console.error("remove failed", err);
        }
    }

    private openDetails(item: ListItemRow) {
        // what the details panel shows until it has loaded the full record
        this.rooster.openCard({
            id: item.metaDataId,
            title: item.title,
            year: item.year,
            poster: item.poster,
            type: item.type,
            isWatched: item.isWatched,
            rating: item.rating,
            mediaFileCount: 0,
            resolution: "",
        });
    }

    private renderProgress(item: ListItemRow) {
        // Series: episode-based progress.
        if (item.series && item.episodesTotal > 0) {
            const rawPct = Math.round((item.episodesWatched / item.episodesTotal) * 100);
            // Manual "watched" toggle wins — show 100% green.
            const pct = item.isWatched ? 100 : Math.min(100, rawPct);
            const finished = item.isWatched || pct >= 100;
            return html`<div class="ld-progress" title="${item.episodesWatched} / ${item.episodesTotal} episodes">
                <div class="ld-progress-track">
                    <div class="ld-progress-bar ${finished ? 'finished' : ''}" style="width: ${pct}%"></div>
                </div>
                <div class="ld-progress-text">
                    ${pct}% · ${item.episodesWatched}/${item.episodesTotal}
                </div>
            </div>`;
        }
        // Movies: green 100% when manually marked watched, otherwise mpv
        // playback progress (only render if there's some progress to show).
        if (!item.series) {
            if (item.isWatched) {
                return html`<div class="ld-progress" title="Watched">
                    <div class="ld-progress-track">
                        <div class="ld-progress-bar finished" style="width: 100%"></div>
                    </div>
                    <div class="ld-progress-text">Watched</div>
                </div>`;
            }
            if (item.moviePercent != null && item.moviePercent > 0) {
                const pct = Math.min(100, Math.round(item.moviePercent));
                const finished = !!item.movieFinished;
                const label = finished ? "Watched" : `${pct}%`;
                return html`<div class="ld-progress" title="Playback progress: ${pct}%">
                    <div class="ld-progress-track">
                        <div class="ld-progress-bar ${finished ? 'finished' : ''}" style="width: ${pct}%"></div>
                    </div>
                    <div class="ld-progress-text">${label}</div>
                </div>`;
            }
        }
        return html``;
    }

    public render() {
        return html`<div class="list-detail-page">
            <div class="ld-header">
                <button class="ld-back" @click=${this.back}>
                    <i class="material-icons">arrow_back</i> Back
                </button>
                <h1 @click=${this.renameList} title="Click to rename">${this.listName}</h1>
                <span class="ld-count">${this.items.length} ${this.items.length === 1 ? "item" : "items"}</span>
                <span class="ld-spacer"></span>
                <button class="ld-delete" @click=${this.deleteList} title="Delete list">
                    <i class="material-icons">delete</i>
                </button>
            </div>

            ${this.isLoading
                ? html`<div class="ld-empty">Loading…</div>`
                : this.items.length === 0
                ? html`<div class="ld-empty">
                      This list is empty. Open any movie/series and click <strong>Add to list</strong>.
                  </div>`
                : html`<div class="ld-rows">
                      ${this.items.map(
                          item => html`<div
                              class="ld-row ${item.isWatched ? "watched" : ""}"
                              data-meta-id=${item.metaDataId}
                              @click=${() => this.openDetails(item)}>
                              <div
                                  class="ld-handle"
                                  title="Drag to reorder"
                                  @click=${(e: Event) => e.stopPropagation()}
                                  @mousedown=${(e: Event) => e.stopPropagation()}>
                                  <i class="material-icons">drag_indicator</i>
                              </div>
                              <div class="ld-poster">
                                  ${item.poster
                                      ? html`<img src="${item.poster}" alt="${item.title}" loading="lazy" />`
                                      : html`<div class="ld-poster-missing">${item.title}</div>`}
                              </div>
                              <div class="ld-info">
                                  <div class="ld-title">${item.title}</div>
                                  <div class="ld-sub">
                                      ${item.year ? html`<span>${item.year}</span>` : ""}
                                      ${item.series ? html`<span class="ld-chip">Series</span>` : ""}
                                      ${item.rating ? html`<span class="ld-rating">★ ${item.rating}</span>` : ""}
                                  </div>
                                  ${this.renderProgress(item)}
                              </div>
                              <button
                                  class="ld-watch ${item.isWatched ? "on" : ""}"
                                  title="${item.isWatched ? "Mark unwatched" : "Mark watched"}"
                                  @click=${(e: Event) => this.toggleWatched(e, item)}>
                                  <i class="material-icons">${item.isWatched ? "visibility" : "visibility_off"}</i>
                              </button>
                              <button class="ld-remove" title="Remove from list"
                                  @click=${(e: Event) => this.removeItem(e, item)}>
                                  <i class="material-icons">close</i>
                              </button>
                          </div>`,
                      )}
                  </div>`}
        </div>`;
    }
}
