import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {RoosterX} from "./RoosterX";
import {type IListRow} from "../common/models/IList";
import {posterUrl} from "../common/library";

interface ListSummary {
    id: number;
    userId: number;
    name: string;
    createdAt: number;
    updatedAt: number;
    itemCount: number;
    posters: string[];
}

@customElement("rooster-lists")
export class Lists extends LitElement {
    @property() public rooster: RoosterX;
    @state() private lists: ListSummary[] = [];
    @state() private isLoading: boolean = false;
    @state() private creating: boolean = false;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
    }

    private refresh() {
        this.isLoading = true;
        IpcService.getLists()
            .then(data => {
                this.lists = (data || []).map(this.toSummary);
                this.isLoading = false;
            })
            .catch(err => {
                console.error("getLists failed", err);
                this.isLoading = false;
            });
    }

    private toSummary = (l: IListRow): ListSummary => ({
        ...l,
        posters: (l.posters || []).map(p => p && posterUrl(p)),
    });

    private async onCreate() {
        const name = window.prompt("New list name:");
        if (!name || !name.trim()) return;
        this.creating = true;
        try {
            await IpcService.createList(name.trim());
            this.refresh();
        } catch (err) {
            console.error("createList failed", err);
        } finally {
            this.creating = false;
        }
    }

    private async onRename(e: Event, list: ListSummary) {
        e.stopPropagation();
        const name = window.prompt("Rename list:", list.name);
        if (!name || !name.trim() || name.trim() === list.name) return;
        try {
            await IpcService.updateList(list.id, name.trim());
            this.refresh();
        } catch (err) {
            console.error("updateList failed", err);
        }
    }

    private async onDelete(e: Event, list: ListSummary) {
        e.stopPropagation();
        if (!window.confirm(`Delete list "${list.name}"? This cannot be undone.`)) return;
        try {
            await IpcService.deleteList(list.id);
            this.refresh();
        } catch (err) {
            console.error("deleteList failed", err);
        }
    }

    private openList(list: ListSummary) {
        this.rooster.navigate({view: "lists", listId: list.id});
    }

    private renderStack(posters: string[], name: string) {
        if (!posters || posters.length === 0) {
            return html`<div class="ll-stack ll-stack-empty">
                <i class="material-icons">queue_music</i>
            </div>`;
        }
        // Up to 5 posters, fanned/overlapped left-to-right.
        return html`<div class="ll-stack">
            ${posters.slice(0, 5).map(
                (p, i) => html`<img
                    src="${p}"
                    alt="${name}"
                    style="--i:${i}"
                    loading="lazy" />`,
            )}
        </div>`;
    }

    public render() {
        return html`<div class="lists-page">
            <div class="lists-header">
                <h1>My Lists</h1>
                <button class="ll-new" @click=${this.onCreate} ?disabled=${this.creating}>
                    <i class="material-icons">add</i> New list
                </button>
            </div>

            ${this.isLoading
                ? html`<div class="ll-empty">Loading…</div>`
                : this.lists.length === 0
                ? html`<div class="ll-empty">
                      No lists yet. Click <strong>New list</strong> to create your first one.
                  </div>`
                : html`<div class="ll-rows">
                      ${this.lists.map(
                          l => html`<div class="ll-row" tabindex="0" @click=${() => this.openList(l)}>
                              ${this.renderStack(l.posters, l.name)}
                              <div class="ll-meta">
                                  <div class="ll-name">${l.name}</div>
                                  <div class="ll-count">
                                      ${l.itemCount} ${l.itemCount === 1 ? "item" : "items"}
                                  </div>
                              </div>
                              <div class="ll-actions">
                                  <button title="Rename" @click=${(e: Event) => this.onRename(e, l)}>
                                      <i class="material-icons">edit</i>
                                  </button>
                                  <button title="Delete" @click=${(e: Event) => this.onDelete(e, l)}>
                                      <i class="material-icons">delete</i>
                                  </button>
                              </div>
                          </div>`,
                      )}
                  </div>`}
        </div>`;
    }
}
