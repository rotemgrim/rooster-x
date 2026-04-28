import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import Sortable from "sortablejs";
import {IpcService} from "../services/ipc.service";
import {RoosterX} from "./RoosterX";
import "./VideoDetails";

interface ListItemRow {
    id: number;
    listId: number;
    metaDataId: number;
    position: number;
    addedAt: number;
    title: string;
    year?: number;
    poster?: string;
    type?: string;
    series?: boolean;
    rating?: number;
    isWatched?: boolean;
    episodesTotal: number;
    episodesWatched: number;
}

@customElement("list-detail")
export class ListDetail extends LitElement {
    @property() public rooster: RoosterX;
    @property({type: Number}) public listId: number;

    @state() private items: ListItemRow[] = [];
    @state() private listName: string = "";
    @state() private isLoading: boolean = false;
    @state() private openItem: ListItemRow | null = null;

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
        if (changed.has("listId")) {
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
        // the reordered data array. Without this, Lit reuses elements at
        // their post-Sortable positions and ends up double-moving them.
        const parent = evt.from as HTMLElement;
        const movedEl = evt.item as HTMLElement;
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
                const meta = (lists || []).find((l: any) => l.id === this.listId);
                this.listName = meta?.name || "List";
                this.items = (items || []).map(this.normalize);
                this.isLoading = false;
            })
            .catch(err => {
                console.error("ListDetail refresh failed", err);
                this.isLoading = false;
            });
    }

    private normalize = (r: any): ListItemRow => ({
        id: r.id,
        listId: r.listId,
        metaDataId: r.metaDataId,
        position: r.position,
        addedAt: r.addedAt,
        title: r.title || "",
        year: r.year || undefined,
        poster: r.poster
            ? r.poster.startsWith("http")
                ? r.poster
                : `https://image.tmdb.org/t/p/w300${r.poster}`
            : undefined,
        type: r.type,
        series: !!r.series,
        rating: r.rating,
        isWatched: !!r.isWatched,
        episodesTotal: r.episodesTotal || 0,
        episodesWatched: r.episodesWatched || 0,
    });

    private back() {
        this.rooster.showLists();
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
            this.rooster.showLists();
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
            // Optimistic local update; for series the user can still see
            // episode-progress through reload (or we trust the global flag).
            item.isWatched = next;
            this.requestUpdate();
        } catch (err) {
            console.error("setWatched failed", err);
        }
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
        this.openItem = item;
        // Sync URL so back-button closes the panel.
        history.pushState(
            {view: "lists", listId: this.listId, id: item.metaDataId},
            item.title,
            `/lists/${this.listId}/${item.type || "movie"}/${item.metaDataId}`,
        );
    }

    private closeDetails() {
        this.openItem = null;
        history.pushState({view: "lists", listId: this.listId}, "", `/lists/${this.listId}`);
        // After the details panel may have changed watched state, refresh.
        this.refresh();
    }

    private renderProgress(item: ListItemRow) {
        if (!item.series || item.episodesTotal <= 0) return html``;
        const pct = Math.min(100, Math.round((item.episodesWatched / item.episodesTotal) * 100));
        return html`<div class="ld-progress" title="${item.episodesWatched} / ${item.episodesTotal} episodes">
            <div class="ld-progress-bar" style="width: ${pct}%"></div>
            <div class="ld-progress-text">${item.episodesWatched} / ${item.episodesTotal}</div>
        </div>`;
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
                              <div class="ld-handle" title="Drag to reorder">
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

            ${this.openItem
                ? html`<video-details
                      .rooster=${this.rooster}
                      .card=${{closeDetails: () => this.closeDetails()}}
                      .video=${{
                          id: this.openItem.metaDataId,
                          title: this.openItem.title,
                          year: this.openItem.year,
                          poster: this.openItem.poster,
                          type: this.openItem.type || "movie",
                          isWatched: this.openItem.isWatched,
                          rating: this.openItem.rating,
                          mediaFiles: 0,
                          torrentFiles: 0,
                          resolution: "",
                      }}></video-details>`
                : ""}
        </div>`;
    }
}
