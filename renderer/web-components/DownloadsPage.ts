import {LitElement, html, nothing, type TemplateResult} from "lit";
import {customElement, state} from "lit/decorators.js";
import {repeat} from "lit/directives/repeat.js";
import {EngineService, isVideo, largestVideo, type EngineState, type IEngineFile, type IEngineStatus} from "../services/engine.service";
import {formatBytes, formatDuration, formatSpeed, formatUnixDate} from "../common/commonUtils";
import {modal} from "./dialog";
import "./TorrentSettingsDialog";

type Torrent = IEngineStatus;

const POLL_MS = 1500;

const STATE_LABEL: Record<EngineState, string> = {
    metadata: "Downloading metadata",
    downloading: "Downloading",
    stalled: "Stalled",
    queued: "Queued",
    seeding: "Seeding",
    paused: "Paused",
    completed: "Completed",
};
const STATE_ICON: Record<EngineState, string> = {
    metadata: "south",
    downloading: "south",
    stalled: "south",
    queued: "schedule",
    seeding: "done",
    paused: "pause",
    completed: "done",
};
// sort order of the Status column
const STATE_ORDER: EngineState[] = ["downloading", "metadata", "stalled", "queued", "seeding", "paused", "completed"];

const progress = (t: Torrent) => (t.hasInfo && t.length ? t.completed / t.length : 0);
const leechers = (t: Torrent) => t.peers - t.seeders;
// unknown ETA (-1) sorts after every real one
const etaSortValue = (t: Torrent) => (t.eta < 0 ? Infinity : t.eta);

const progressBar = (fraction: number) =>
    html`<div class="dl-progress"><div style="width: ${fraction * 100}%"></div><span>${(fraction * 100).toFixed(1)}%</span></div>`;

type SortKey = "name" | "size" | "progress" | "status" | "seeds" | "peers" | "downSpeed" | "upSpeed"
    | "eta" | "ratio" | "uploaded" | "addedAt" | "completedAt" | "availability";

interface Column {
    key: SortKey;
    label: string;
    width: number;
    numeric?: boolean;
    sortValue: (t: Torrent) => number | string;
    render: (t: Torrent) => TemplateResult | string;
}

const COLUMNS: Column[] = [
    {
        key: "name", label: "Name", width: 360,
        sortValue: t => t.name.toLowerCase(),
        render: t => html`<span class="dl-state-icon material-icons">${STATE_ICON[t.state]}</span>${t.name || t.infoHash}`,
    },
    {key: "size", label: "Size", width: 90, numeric: true, sortValue: t => t.length, render: t => (t.hasInfo ? formatBytes(t.length) : "")},
    {key: "progress", label: "Progress", width: 120, numeric: true, sortValue: progress, render: t => progressBar(progress(t))},
    {key: "status", label: "Status", width: 140, sortValue: t => STATE_ORDER.indexOf(t.state), render: t => STATE_LABEL[t.state]},
    {key: "seeds", label: "Seeds", width: 70, numeric: true, sortValue: t => t.seeders, render: t => `${t.seeders}`},
    {
        key: "peers", label: "Peers", width: 80, numeric: true,
        sortValue: leechers,
        render: t => html`<span title="connected leechers (peers known in the swarm)">${leechers(t)} (${t.knownPeers})</span>`,
    },
    {key: "downSpeed", label: "Down Speed", width: 100, numeric: true, sortValue: t => t.downSpeed, render: t => formatSpeed(t.downSpeed)},
    {key: "upSpeed", label: "Up Speed", width: 90, numeric: true, sortValue: t => t.upSpeed, render: t => formatSpeed(t.upSpeed)},
    {key: "eta", label: "ETA", width: 70, numeric: true, sortValue: etaSortValue, render: t => formatDuration(t.eta)},
    {key: "ratio", label: "Ratio", width: 60, numeric: true, sortValue: t => t.ratio, render: t => t.ratio.toFixed(2)},
    {key: "uploaded", label: "Uploaded", width: 90, numeric: true, sortValue: t => t.uploaded, render: t => formatBytes(t.uploaded)},
    {key: "addedAt", label: "Added On", width: 130, numeric: true, sortValue: t => t.addedAt, render: t => formatUnixDate(t.addedAt)},
    {key: "completedAt", label: "Completed On", width: 130, numeric: true, sortValue: t => t.completedAt, render: t => formatUnixDate(t.completedAt)},
    {
        key: "availability", label: "Availability", width: 85, numeric: true,
        sortValue: t => t.availability,
        render: t => (t.hasInfo ? t.availability.toFixed(3) : ""),
    },
];

type FilterKey = "all" | "active" | "done";

const FILTERS: {key: FilterKey; label: string; icon: string; test: (t: Torrent) => boolean}[] = [
    {key: "all", label: "All", icon: "list", test: () => true},
    {key: "active", label: "Not completed", icon: "downloading", test: t => !t.done},
    {key: "done", label: "Completed", icon: "done_all", test: t => t.done},
];

const PREFS_KEY = "roosterx-downloads";

interface Prefs {
    sortKey: SortKey;
    sortDesc: boolean;
    widths: Partial<Record<SortKey, number>>;
    detailsHeight: number;
    filter: FilterKey;
}

function loadPrefs(): Prefs {
    const prefs: Prefs = {sortKey: "addedAt", sortDesc: true, widths: {}, detailsHeight: 300, filter: "all"};
    try {
        Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch (_) {}
    if (!COLUMNS.some(c => c.key === prefs.sortKey)) {
        prefs.sortKey = "addedAt";
    }
    if (!FILTERS.some(f => f.key === prefs.filter)) {
        prefs.filter = "all";
    }
    return prefs;
}

/** Drags a pointer and reports the distance moved since it went down. */
function drag(e: PointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const {clientX, clientY} = e;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onMove(ev.clientX - clientX, ev.clientY - clientY);
    const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
}

@customElement("downloads-page")
export class DownloadsPage extends LitElement {

    @state() private torrents: Torrent[] = [];
    @state() private loaded = false;
    @state() private selected = "";
    @state() private prefs: Prefs = loadPrefs();
    @state() private tab: "general" | "content" = "general";
    @state() private menu: {x: number; y: number; hash: string} | null = null;
    @state() private deleting: {hash: string; name: string; deleteFiles: boolean} | null = null;
    @state() private showSettings = false;
    private pollTimer: number | undefined;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
        document.addEventListener("pointerdown", this.closeMenuOutside);
        document.addEventListener("keydown", this.onKey);
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        window.clearTimeout(this.pollTimer);
        document.removeEventListener("pointerdown", this.closeMenuOutside);
        document.removeEventListener("keydown", this.onKey);
    }

    private refresh() {
        window.clearTimeout(this.pollTimer);
        EngineService.list()
            .then(list => {
                this.torrents = list ?? [];
                this.loaded = true;
            })
            .catch(err => console.error("could not list torrents", err))
            .finally(() => {
                if (this.isConnected) {
                    this.pollTimer = window.setTimeout(() => this.refresh(), POLL_MS);
                }
            });
    }

    private savePrefs(update: Partial<Prefs>) {
        this.prefs = {...this.prefs, ...update};
        this.persistPrefs();
    }

    /** Stores the prefs; resizing updates them live and stores on release. */
    private persistPrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
        } catch (_) {}
    }

    private get filter() {
        return FILTERS.find(f => f.key === this.prefs.filter) ?? FILTERS[0];
    }

    private get sorted(): Torrent[] {
        const column = COLUMNS.find(c => c.key === this.prefs.sortKey) ?? COLUMNS[0];
        const sign = this.prefs.sortDesc ? -1 : 1;
        return this.torrents.filter(this.filter.test).sort((a, b) => {
            const av = column.sortValue(a);
            const bv = column.sortValue(b);
            if (av !== bv) {
                return (av < bv ? -1 : 1) * sign;
            }
            return a.name.localeCompare(b.name);
        });
    }

    private get current(): Torrent | undefined {
        return this.torrents.find(t => t.infoHash === this.selected);
    }

    private width(c: Column): number {
        return this.prefs.widths[c.key] ?? c.width;
    }

    private sortBy(c: Column) {
        if (this.prefs.sortKey === c.key) {
            this.savePrefs({sortDesc: !this.prefs.sortDesc});
        } else {
            // numbers usually read best biggest/newest first
            this.savePrefs({sortKey: c.key, sortDesc: !!c.numeric});
        }
    }

    private resizeColumn(e: PointerEvent, c: Column) {
        const start = this.width(c);
        drag(e,
            dx => (this.prefs = {...this.prefs, widths: {...this.prefs.widths, [c.key]: Math.max(40, start + dx)}}),
            () => this.persistPrefs());
    }

    private resizeDetails(e: PointerEvent) {
        const start = this.prefs.detailsHeight;
        const max = window.innerHeight - 200;
        drag(e,
            (_, dy) => (this.prefs = {...this.prefs, detailsHeight: Math.min(max, Math.max(80, start - dy))}),
            () => this.persistPrefs());
    }

    private openMenu(e: MouseEvent, t: Torrent) {
        e.preventDefault();
        this.selected = t.infoHash;
        // keep the menu on screen
        this.menu = {x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 200), hash: t.infoHash};
    }

    private closeMenuOutside = (e: PointerEvent) => {
        if (this.menu && !(e.target as HTMLElement).closest(".dl-menu")) {
            this.menu = null;
        }
    };

    private onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            this.menu = null;
            this.deleting = null;
        } else if (e.key === "Delete" && this.current && !this.deleting
            && !(e.target as HTMLElement).closest("input, select, textarea")) {
            this.askDelete(this.current);
        }
    };

    private act(action: Promise<unknown>, what: string) {
        this.menu = null;
        action.catch(err => console.error(`could not ${what}`, err)).finally(() => this.refresh());
    }

    private togglePause(t: Torrent) {
        this.act(EngineService.setPaused(t.infoHash, !t.paused), t.paused ? "resume" : "pause");
    }

    private toggleSequential(t: Torrent) {
        this.act(EngineService.setSequential(t.infoHash, !t.sequential), "change download order");
    }

    private askDelete(t: Torrent) {
        this.menu = null;
        this.deleting = {hash: t.infoHash, name: t.name || t.infoHash, deleteFiles: false};
    }

    private confirmDelete() {
        if (!this.deleting) {
            return;
        }
        const {hash, deleteFiles} = this.deleting;
        this.deleting = null;
        if (this.selected === hash) {
            this.selected = "";
        }
        this.act(EngineService.remove(hash, deleteFiles), "delete torrent");
    }

    private play(t: Torrent, file = largestVideo(t.files)) {
        this.menu = null;
        if (file) {
            EngineService.play(t.infoHash, file);
        }
    }

    private renderFilters() {
        return html`<div class="dl-filters">
            ${FILTERS.map(f => html`<button class="${this.prefs.filter === f.key ? "active" : ""}" @click=${() => this.savePrefs({filter: f.key})}>
                <i class="material-icons">${f.icon}</i>${f.label} (${this.torrents.filter(f.test).length})
            </button>`)}
            <button class="dl-settings-button" title="BitTorrent settings" @click=${() => (this.showSettings = true)}>
                <i class="material-icons">settings</i>Settings
            </button>
        </div>`;
    }

    private renderHeader() {
        const {sortKey, sortDesc} = this.prefs;
        return html`<tr>
            ${COLUMNS.map(c => html`<th class="${c.numeric ? "num" : ""} ${sortKey === c.key ? "sorted" : ""}" @click=${() => this.sortBy(c)}>
                <span class="dl-th-label">${c.label}</span>
                ${sortKey === c.key ? html`<i class="material-icons dl-sort">${sortDesc ? "arrow_drop_down" : "arrow_drop_up"}</i>` : nothing}
                <span class="dl-col-resize" @pointerdown=${(e: PointerEvent) => this.resizeColumn(e, c)}
                    @click=${(e: Event) => e.stopPropagation()}></span>
            </th>`)}
        </tr>`;
    }

    private renderRow(t: Torrent) {
        return html`<tr class="dl-row state-${t.state} ${t.infoHash === this.selected ? "selected" : ""}"
            @click=${() => (this.selected = t.infoHash)}
            @dblclick=${() => this.play(t)}
            @contextmenu=${(e: MouseEvent) => this.openMenu(e, t)}>
            ${COLUMNS.map(c => html`<td class="${c.numeric ? "num" : ""} col-${c.key}">${c.render(t)}</td>`)}
        </tr>`;
    }

    private renderMenu() {
        const menu = this.menu;
        const t = menu && this.torrents.find(x => x.infoHash === menu.hash);
        if (!menu || !t) {
            return nothing;
        }
        const video = largestVideo(t.files);
        return html`<ul class="dl-menu" style="left: ${menu.x}px; top: ${menu.y}px">
            <li @click=${() => this.togglePause(t)}>
                <i class="material-icons">${t.paused ? "play_arrow" : "pause"}</i>${t.paused ? "Resume" : "Pause"}
            </li>
            <li class="${video ? "" : "disabled"}" @click=${() => video && this.play(t, video)}>
                <i class="material-icons">play_circle</i>Stream in mpv
            </li>
            <li @click=${() => this.toggleSequential(t)}>
                <i class="material-icons">${t.sequential ? "check_box" : "check_box_outline_blank"}</i>First &amp; last parts first, then in order
            </li>
            <li class="separator"></li>
            <li class="danger" @click=${() => this.askDelete(t)}><i class="material-icons">delete</i>Delete…</li>
        </ul>`;
    }

    private renderDeleteDialog() {
        const deleting = this.deleting;
        if (!deleting) {
            return nothing;
        }
        return modal(() => (this.deleting = null), html`<div class="modal" role="dialog" aria-modal="true">
            <h3>Remove torrent</h3>
            <p>Are you sure you want to remove "${deleting.name}" from the transfer list?</p>
            <label>
                <input type="checkbox" .checked=${deleting.deleteFiles}
                    @change=${(e: Event) => (this.deleting = {...deleting, deleteFiles: (e.target as HTMLInputElement).checked})} />
                Also permanently delete the downloaded files
            </label>
            <div class="modal-buttons">
                <button @click=${() => (this.deleting = null)}>Cancel</button>
                <button class="danger" @click=${this.confirmDelete}>Remove</button>
            </div>
        </div>`);
    }

    private field(label: string, value: unknown) {
        return html`<div class="dl-field"><span>${label}:</span><span>${value}</span></div>`;
    }

    private renderGeneral(t: Torrent) {
        const left = t.hasInfo ? t.length - t.completed : 0;
        const pieces = t.hasInfo ? `${t.numPieces} x ${formatBytes(t.pieceLength)} (have ${t.piecesComplete})` : "";
        return html`<h4>Transfer</h4>
            <div class="dl-fields">
                ${this.field("ETA", formatDuration(t.eta))}
                ${this.field("Downloaded", formatBytes(t.downloaded))}
                ${this.field("Uploaded", formatBytes(t.uploaded))}
                ${this.field("Remaining", formatBytes(left))}
                ${this.field("Download Speed", formatSpeed(t.downSpeed))}
                ${this.field("Upload Speed", formatSpeed(t.upSpeed))}
                ${this.field("Seeds", t.seeders)}
                ${this.field("Peers", `${leechers(t)} (${t.knownPeers} known)`)}
                ${this.field("Share Ratio", t.ratio.toFixed(2))}
                ${this.field("Availability", t.hasInfo ? t.availability.toFixed(3) : "")}
                ${this.field("Status", STATE_LABEL[t.state])}
                ${this.field("Download Order", t.sequential ? "First & last parts first, then in order" : "Rarest first")}
            </div>
            <h4>Information</h4>
            <div class="dl-fields">
                ${this.field("Total Size", t.hasInfo ? formatBytes(t.length) : "")}
                ${this.field("Pieces", pieces)}
                ${this.field("Added On", formatUnixDate(t.addedAt))}
                ${this.field("Completed On", formatUnixDate(t.completedAt))}
                ${this.field("Info Hash", t.infoHash)}
                ${this.field("Save Path", t.savePath)}
            </div>`;
    }

    private renderContent(t: Torrent) {
        if (!t.files?.length) {
            return html`<div class="dl-empty">Waiting for torrent metadata…</div>`;
        }
        return html`<table class="dl-files">
            <thead><tr><th>Name</th><th class="num">Size</th><th class="num">Progress</th><th></th></tr></thead>
            <tbody>
                ${t.files.map((f: IEngineFile) => html`<tr>
                    <td>${f.path}</td>
                    <td class="num">${formatBytes(f.length)}</td>
                    <td class="num">${progressBar(f.length ? f.completed / f.length : 1)}</td>
                    <td>${isVideo(f)
                        ? html`<i class="material-icons dl-play" title="Stream in mpv" @click=${() => this.play(t, f)}>play_circle</i>`
                        : nothing}</td>
                </tr>`)}
            </tbody>
        </table>`;
    }

    private renderDetails() {
        const t = this.current;
        return html`<div class="dl-splitter" @pointerdown=${this.resizeDetails}></div>
            <div class="dl-details" style="height: ${this.prefs.detailsHeight}px">
                <div class="dl-details-body">
                    ${!t ? html`<div class="dl-empty">Select a torrent to see its details</div>`
                        : this.tab === "general" ? this.renderGeneral(t) : this.renderContent(t)}
                </div>
                <div class="dl-tabs">
                    <button class="${this.tab === "general" ? "active" : ""}" @click=${() => (this.tab = "general")}>
                        <i class="material-icons">info</i>General
                    </button>
                    <button class="${this.tab === "content" ? "active" : ""}" @click=${() => (this.tab = "content")}>
                        <i class="material-icons">folder</i>Content
                    </button>
                </div>
            </div>`;
    }

    public render() {
        const tableWidth = COLUMNS.reduce((sum, c) => sum + this.width(c), 0);
        const rows = this.sorted;
        return html`<div class="downloads-page">
            ${this.renderFilters()}
            <div class="dl-table-wrap">
                <table class="dl-table" style="width: ${tableWidth}px">
                    <colgroup>${COLUMNS.map(c => html`<col style="width: ${this.width(c)}px" />`)}</colgroup>
                    <thead>${this.renderHeader()}</thead>
                    <tbody>${repeat(rows, t => t.infoHash, t => this.renderRow(t))}</tbody>
                </table>
                ${!this.loaded ? nothing
                    : !this.torrents.length ? html`<div class="dl-empty">No torrents yet. Start one from a movie or episode's torrent list.</div>`
                    : !rows.length ? html`<div class="dl-empty">No ${this.filter.label.toLowerCase()} torrents.</div>`
                    : nothing}
            </div>
            ${this.renderDetails()}
            ${this.renderMenu()}
            ${this.renderDeleteDialog()}
            ${this.showSettings ? html`<torrent-settings-dialog @close=${() => (this.showSettings = false)}></torrent-settings-dialog>` : nothing}
        </div>`;
    }
}
