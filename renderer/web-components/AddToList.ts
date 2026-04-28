import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {RoosterX} from "./RoosterX";

interface ListSummary {
    id: number;
    name: string;
    itemCount: number;
}

/**
 * Popup launched from VideoDetails. Shows the user's lists with a checkbox
 * per list reflecting current membership; toggling a checkbox adds/removes
 * the metaData item from that list immediately. Footer button navigates to
 * /lists for fuller management (renaming, deleting, drag-to-reorder).
 */
@customElement("add-to-list")
export class AddToList extends LitElement {
    @property() public rooster: RoosterX;
    @property({type: Number}) public metaDataId: number;
    @property({type: Object}) public onClose: () => void;

    @state() private lists: ListSummary[] = [];
    @state() private memberIds: Set<number> = new Set();
    @state() private isLoading: boolean = false;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
    }

    private refresh() {
        this.isLoading = true;
        Promise.all([
            IpcService.getLists(),
            IpcService.getListsContaining(this.metaDataId),
        ])
            .then(([lists, memberIds]) => {
                this.lists = (lists || []).map((l: any) => ({
                    id: l.id,
                    name: l.name,
                    itemCount: l.itemCount || 0,
                }));
                this.memberIds = new Set(memberIds || []);
                this.isLoading = false;
            })
            .catch(err => {
                console.error("AddToList refresh failed", err);
                this.isLoading = false;
            });
    }

    private async toggle(list: ListSummary) {
        const isMember = this.memberIds.has(list.id);
        try {
            if (isMember) {
                await IpcService.removeListItem(list.id, this.metaDataId);
                this.memberIds.delete(list.id);
            } else {
                await IpcService.addListItem(list.id, this.metaDataId);
                this.memberIds.add(list.id);
            }
            this.requestUpdate();
        } catch (err) {
            console.error("toggle list membership failed", err);
        }
    }

    private goToLists() {
        this.onClose && this.onClose();
        this.rooster.showLists();
    }

    private close(e: Event) {
        if ((e.target as HTMLElement).classList.contains("atl-backdrop")) {
            this.onClose && this.onClose();
        }
    }

    public render() {
        return html`<div class="atl-backdrop" @click=${this.close}>
            <div class="atl-popup" role="dialog" aria-label="Add to list">
                <div class="atl-header">
                    <h2>Add to list</h2>
                    <button class="atl-x" @click=${() => this.onClose && this.onClose()}>
                        <i class="material-icons">close</i>
                    </button>
                </div>
                <div class="atl-body">
                    ${this.isLoading
                        ? html`<div class="atl-empty">Loading…</div>`
                        : this.lists.length === 0
                        ? html`<div class="atl-empty">
                              No lists yet. Create one from the lists view.
                          </div>`
                        : html`<ul class="atl-rows">
                              ${this.lists.map(
                                  l => html`<li
                                      class="atl-row ${this.memberIds.has(l.id) ? "checked" : ""}"
                                      @click=${() => this.toggle(l)}>
                                      <i class="material-icons atl-check">
                                          ${this.memberIds.has(l.id) ? "check_box" : "check_box_outline_blank"}
                                      </i>
                                      <span class="atl-name">${l.name}</span>
                                      <span class="atl-count">${l.itemCount}</span>
                                  </li>`,
                              )}
                          </ul>`}
                </div>
                <div class="atl-footer">
                    <button class="atl-manage" @click=${this.goToLists}>
                        <i class="material-icons">playlist_play</i> Manage lists
                    </button>
                </div>
            </div>
        </div>`;
    }
}
