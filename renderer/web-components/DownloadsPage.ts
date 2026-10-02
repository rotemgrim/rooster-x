import {LitElement, html, nothing, type TemplateResult} from "lit";
import {customElement, state} from "lit/decorators.js";
import {repeat} from "lit/directives/repeat.js";
import {IpcService, type IEngineSettings, type IEngineStatus} from "../services/ipc.service";

type Torrent = IEngineStatus;
type SortKey = keyof typeof COLUMNS;

interface Column {
    label: string;
    width: number;
    numeric?: boolean;
    sortValue: (t: Torrent) => number | string;
    render: (t: Torrent) => TemplateResult | string;
}

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv)$/i;
const POLL_MS = 1500;

const STATE_LABEL: Record<Torrent["state"], string> = {
    metadata: "Downloading metadata",
    downloading: "Downloading",
    stalled: "Stalled",
    queued: "Queued",
    seeding: "Seeding",
    paused: "Paused",
    completed: "Completed",
};
// sort order of the Status column
const STATE_ORDER: Torrent["state"][] = ["downloading", "metadata", "stalled", "queued", "seeding", "paused", "completed"];

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

function formatSize(bytes: number): string {
    let i = 0;
    while (bytes >= 1024 && i < UNITS.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${i === 0 ? bytes : bytes.toFixed(1)} ${UNITS[i]}`;
}

const formatSpeed = (bps: number) => `${formatSize(bps)}/s`;

function formatDuration(seconds: number): string {
    if (!isFinite(seconds)) {
        return "∞";
    }
    if (seconds < 60) {
        return "< 1m";
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(unix: number): string {
    if (!unix) {
        return "";
    }
    return new Date(unix * 1000).toLocaleString(undefined, {
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    });
}

const progress = (t: Torrent) => (t.hasInfo && t.length ? t.completed / t.length : 0);

function eta(t: Torrent): number {
    if (t.hasInfo && t.completed >= t.length) {
        return Infinity;
    }
    return t.downSpeed > 0 && t.hasInfo ? (t.length - t.completed) / t.downSpeed : Infinity;
}

// qBittorrent: uploaded / downloaded, falling back to the completed size for
// torrents whose data mostly came from disk rather than peers.
function ratio(t: Torrent): number {
    const base = t.downloaded < t.completed * 0.01 ? t.completed : t.downloaded;
    return base ? t.uploaded / base : 0;
}

const COLUMNS = {
    name: {
        label: "Name", width: 360,
        sortValue: t => t.name.toLowerCase(),
        render: t => html`<span class="dl-state-icon material-icons">${t.state === "seeding" || t.state === "completed" ? "done" : t.state === "paused" ? "pause" : t.state === "queued" ? "schedule" : "south"}</span>${t.name || t.infoHash}`,
    },
    size: {label: "Size", width: 90, numeric: true, sortValue: t => t.length, render: t => (t.hasInfo ? formatSize(t.length) : "")},
    progress: {
        label: "Progress", width: 120, numeric: true,
        sortValue: progress,
        render: t => html`<div class="dl-progress"><div style="width: ${progress(t) * 100}%"></div><span>${(progress(t) * 100).toFixed(1)}%</span></div>`,
    },
    status: {
        label: "Status", width: 140,
        sortValue: t => STATE_ORDER.indexOf(t.state),
        render: t => STATE_LABEL[t.state] ?? t.state,
    },
    seeds: {label: "Seeds", width: 70, numeric: true, sortValue: t => t.seeders, render: t => `${t.seeders}`},
    peers: {
        label: "Peers", width: 80, numeric: true,
        sortValue: t => t.peers - t.seeders,
        render: t => html`<span title="connected leechers (peers known in the swarm)">${t.peers - t.seeders} (${t.knownPeers})</span>`,
    },
    downSpeed: {label: "Down Speed", width: 100, numeric: true, sortValue: t => t.downSpeed, render: t => formatSpeed(t.downSpeed)},
    upSpeed: {label: "Up Speed", width: 90, numeric: true, sortValue: t => t.upSpeed, render: t => formatSpeed(t.upSpeed)},
    eta: {label: "ETA", width: 70, numeric: true, sortValue: eta, render: t => formatDuration(eta(t))},
    ratio: {label: "Ratio", width: 60, numeric: true, sortValue: ratio, render: t => ratio(t).toFixed(2)},
    uploaded: {label: "Uploaded", width: 90, numeric: true, sortValue: t => t.uploaded, render: t => formatSize(t.uploaded)},
    addedAt: {label: "Added On", width: 130, numeric: true, sortValue: t => t.addedAt, render: t => formatDate(t.addedAt)},
    completedAt: {label: "Completed On", width: 130, numeric: true, sortValue: t => t.completedAt, render: t => formatDate(t.completedAt)},
    availability: {
        label: "Availability", width: 85, numeric: true,
        sortValue: t => t.availability,
        render: t => (t.hasInfo ? t.availability.toFixed(3) : ""),
    },
} satisfies Record<string, Column>;

const COLUMN_KEYS = Object.keys(COLUMNS) as SortKey[];
const PREFS_KEY = "roosterx-downloads";

const isDone = (t: Torrent) => t.hasInfo && t.completed >= t.length;

const FILTERS = {
    all: {label: "All", icon: "list", test: (_: Torrent) => true},
    active: {label: "Not completed", icon: "downloading", test: (t: Torrent) => !isDone(t)},
    done: {label: "Completed", icon: "done_all", test: isDone},
};
type Filter = keyof typeof FILTERS;

interface Prefs {
    sortKey: SortKey;
    sortDesc: boolean;
    widths: Partial<Record<SortKey, number>>;
    detailsHeight: number;
    filter: Filter;
}

function loadPrefs(): Prefs {
    const prefs: Prefs = {sortKey: "addedAt", sortDesc: true, widths: {}, detailsHeight: 300, filter: "all"};
    try {
        Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch (_) {}
    if (!(prefs.sortKey in COLUMNS)) {
        prefs.sortKey = "addedAt";
    }
    if (!(prefs.filter in FILTERS)) {
        prefs.filter = "all";
    }
    return prefs;
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
    // the settings dialog's draft while it is open
    @state() private settings: IEngineSettings | null = null;
    @state() private settingsError = "";
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
        IpcService.engineList()
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
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
        } catch (_) {}
    }

    private get sorted(): Torrent[] {
        const {sortKey, sortDesc} = this.prefs;
        const value = COLUMNS[sortKey].sortValue as (t: Torrent) => number | string;
        const sign = sortDesc ? -1 : 1;
        return this.torrents.filter(FILTERS[this.prefs.filter].test).sort((a, b) => {
            const av = value(a);
            const bv = value(b);
            if (av !== bv) {
                return (av < bv ? -1 : 1) * sign;
            }
            return a.name.localeCompare(b.name);
        });
    }

    private get current(): Torrent | undefined {
        return this.torrents.find(t => t.infoHash === this.selected);
    }

    private width(key: SortKey): number {
        return this.prefs.widths[key] ?? COLUMNS[key].width;
    }

    private sortBy(key: SortKey) {
        if (this.prefs.sortKey === key) {
            this.savePrefs({sortDesc: !this.prefs.sortDesc});
        } else {
            // numbers usually read best biggest/newest first
            this.savePrefs({sortKey: key, sortDesc: !!(COLUMNS[key] as Column).numeric});
        }
    }

    /** Drags a pointer and reports the distance moved; used by both resizers. */
    private drag(e: PointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
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

    private resizeColumn(e: PointerEvent, key: SortKey) {
        const start = this.width(key);
        this.drag(e,
            dx => (this.prefs = {...this.prefs, widths: {...this.prefs.widths, [key]: Math.max(40, start + dx)}}),
            () => this.savePrefs({}));
    }

    private resizeDetails(e: PointerEvent) {
        const start = this.prefs.detailsHeight;
        const max = window.innerHeight - 200;
        this.drag(e,
            (_, dy) => (this.prefs = {...this.prefs, detailsHeight: Math.min(max, Math.max(80, start - dy))}),
            () => this.savePrefs({}));
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
            this.settings = null;
        } else if (e.key === "Delete" && this.current && !this.deleting && !(e.target as HTMLElement).closest("input")) {
            this.askDelete(this.current);
        }
    };

    private act(action: Promise<unknown>, what: string) {
        this.menu = null;
        action.catch(err => console.error(`could not ${what}`, err)).finally(() => this.refresh());
    }

    private togglePause(t: Torrent) {
        this.act(IpcService.enginePause(t.infoHash, !t.paused), t.paused ? "resume" : "pause");
    }

    private toggleSequential(t: Torrent) {
        this.act(IpcService.engineSetSequential(t.infoHash, !t.sequential), "change download order");
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
        this.act(IpcService.engineRemove(hash, deleteFiles), "delete torrent");
    }

    private videoFiles(t: Torrent) {
        return (t.files ?? []).filter(f => VIDEO_EXT.test(f.path));
    }

    private play(t: Torrent, index?: number) {
        this.menu = null;
        const videos = this.videoFiles(t);
        const f = index != null ? t.files?.find(x => x.index === index) : videos.reduce((a, b) => (b.length > a.length ? b : a), videos[0]);
        if (!f) {
            return;
        }
        const name = encodeURIComponent(f.path.split("/").pop() ?? "");
        // plain http on the same host the UI was opened from; mpv rejects the
        // self-signed cert used on :8443
        IpcService.openInMPV(`http://${location.hostname}:8080/engine/stream/${t.infoHash}/${f.index}/${name}`);
    }

    private renderHeader() {
        const {sortKey, sortDesc} = this.prefs;
        return html`<tr>
            ${COLUMN_KEYS.map(key => {
                const col = COLUMNS[key] as Column;
                return html`<th class="${col.numeric ? "num" : ""} ${sortKey === key ? "sorted" : ""}" @click=${() => this.sortBy(key)}>
                    <span class="dl-th-label">${col.label}</span>
                    ${sortKey === key ? html`<i class="material-icons dl-sort">${sortDesc ? "arrow_drop_down" : "arrow_drop_up"}</i>` : nothing}
                    <span class="dl-col-resize" @pointerdown=${(e: PointerEvent) => this.resizeColumn(e, key)}
                        @click=${(e: Event) => e.stopPropagation()}></span>
                </th>`;
            })}
        </tr>`;
    }

    private renderRow(t: Torrent) {
        return html`<tr class="dl-row state-${t.state} ${t.infoHash === this.selected ? "selected" : ""}"
            @click=${() => (this.selected = t.infoHash)}
            @dblclick=${() => this.play(t)}
            @contextmenu=${(e: MouseEvent) => this.openMenu(e, t)}>
            ${COLUMN_KEYS.map(key => {
                const col = COLUMNS[key] as Column;
                return html`<td class="${col.numeric ? "num" : ""} col-${key}">${col.render(t)}</td>`;
            })}
        </tr>`;
    }

    private renderMenu() {
        const menu = this.menu;
        const t = menu && this.torrents.find(x => x.infoHash === menu.hash);
        if (!menu || !t) {
            return nothing;
        }
        const canPlay = this.videoFiles(t).length > 0;
        return html`<ul class="dl-menu" style="left: ${menu.x}px; top: ${menu.y}px">
            <li @click=${() => this.togglePause(t)}>
                <i class="material-icons">${t.paused ? "play_arrow" : "pause"}</i>${t.paused ? "Resume" : "Pause"}
            </li>
            <li class="${canPlay ? "" : "disabled"}" @click=${() => canPlay && this.play(t)}>
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
        return html`<div class="dl-dialog-backdrop" @click=${(e: Event) => e.target === e.currentTarget && (this.deleting = null)}>
            <div class="dl-dialog" role="dialog" aria-modal="true">
                <h3>Remove torrent</h3>
                <p>Are you sure you want to remove "${deleting.name}" from the transfer list?</p>
                <label>
                    <input type="checkbox" .checked=${deleting.deleteFiles}
                        @change=${(e: Event) => (this.deleting = {...deleting, deleteFiles: (e.target as HTMLInputElement).checked})} />
                    Also permanently delete the downloaded files
                </label>
                <div class="dl-dialog-buttons">
                    <button @click=${() => (this.deleting = null)}>Cancel</button>
                    <button class="danger" @click=${this.confirmDelete}>Remove</button>
                </div>
            </div>
        </div>`;
    }

    private field(label: string, value: unknown) {
        return html`<div class="dl-field"><span>${label}:</span><span>${value}</span></div>`;
    }

    private renderGeneral(t: Torrent) {
        const left = t.hasInfo ? t.length - t.completed : 0;
        const pieces = t.hasInfo ? `${t.numPieces} x ${formatSize(t.pieceLength)} (have ${t.piecesComplete})` : "";
        return html`<h4>Transfer</h4>
            <div class="dl-fields">
                ${this.field("ETA", formatDuration(eta(t)))}
                ${this.field("Downloaded", formatSize(t.downloaded))}
                ${this.field("Uploaded", formatSize(t.uploaded))}
                ${this.field("Remaining", formatSize(left))}
                ${this.field("Download Speed", formatSpeed(t.downSpeed))}
                ${this.field("Upload Speed", formatSpeed(t.upSpeed))}
                ${this.field("Seeds", t.seeders)}
                ${this.field("Peers", `${t.peers - t.seeders} (${t.knownPeers} known)`)}
                ${this.field("Share Ratio", ratio(t).toFixed(2))}
                ${this.field("Availability", t.hasInfo ? t.availability.toFixed(3) : "")}
                ${this.field("Status", STATE_LABEL[t.state])}
                ${this.field("Download Order", t.sequential ? "First & last parts first, then in order" : "Rarest first")}
            </div>
            <h4>Information</h4>
            <div class="dl-fields">
                ${this.field("Total Size", t.hasInfo ? formatSize(t.length) : "")}
                ${this.field("Pieces", pieces)}
                ${this.field("Added On", formatDate(t.addedAt))}
                ${this.field("Completed On", formatDate(t.completedAt))}
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
                ${t.files.map(f => {
                    const p = f.length ? f.completed / f.length : 1;
                    return html`<tr>
                        <td>${f.path}</td>
                        <td class="num">${formatSize(f.length)}</td>
                        <td class="num"><div class="dl-progress"><div style="width: ${p * 100}%"></div><span>${(p * 100).toFixed(1)}%</span></div></td>
                        <td>${VIDEO_EXT.test(f.path)
                            ? html`<i class="material-icons dl-play" title="Stream in mpv" @click=${() => this.play(t, f.index)}>play_circle</i>`
                            : nothing}</td>
                    </tr>`;
                })}
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

    private renderFilters() {
        return html`<div class="dl-filters">
            ${(Object.keys(FILTERS) as Filter[]).map(key => {
                const f = FILTERS[key];
                return html`<button class="${this.prefs.filter === key ? "active" : ""}" @click=${() => this.savePrefs({filter: key})}>
                    <i class="material-icons">${f.icon}</i>${f.label} (${this.torrents.filter(f.test).length})
                </button>`;
            })}
            <button class="dl-settings-button" title="BitTorrent settings" @click=${this.openSettings}>
                <i class="material-icons">settings</i>Settings
            </button>
        </div>`;
    }

    private openSettings() {
        this.settingsError = "";
        IpcService.engineGetSettings()
            .then(s => (this.settings = s))
            .catch(err => console.error("could not load torrent settings", err));
    }

    private saveSettings(e: Event) {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
        const num = (name: string) => Math.max(0, Number(field(name).value) || 0);
        const int = (name: string) => Math.round(num(name));
        IpcService.engineSaveSettings({
            seedDays: num("seedDays"),
            ratioLimit: num("ratioLimit"),
            seedEndAction: field("seedEndAction").value === "remove" ? "remove" : "pause",
            maxDownloadKiB: int("maxDownloadKiB"),
            maxUploadKiB: int("maxUploadKiB"),
            maxActiveDownloads: int("maxActiveDownloads"),
            maxConnsPerTorrent: int("maxConnsPerTorrent"),
            sequentialByDefault: field("sequentialByDefault").checked,
            addPaused: field("addPaused").checked,
        })
            .then(() => (this.settings = null))
            .catch(err => (this.settingsError = String(err)));
    }

    /** A number input row; 0 shows as empty with the placeholder (default "no limit"). */
    private numberField(name: string, label: string, value: number, unit: string, step = "1", placeholder = "no limit") {
        return html`<label>
            <span>${label}</span>
            <input name=${name} type="number" min="0" step=${step} placeholder=${placeholder} .value=${value ? String(value) : ""} />
            <span>${unit}</span>
        </label>`;
    }

    private renderSettingsDialog() {
        const s = this.settings;
        if (!s) {
            return nothing;
        }
        return html`<div class="dl-dialog-backdrop" @click=${(e: Event) => e.target === e.currentTarget && (this.settings = null)}>
            <form class="dl-dialog dl-settings" role="dialog" aria-modal="true" @submit=${this.saveSettings}>
                <h3>BitTorrent settings</h3>
                <h4>Seeding</h4>
                ${this.numberField("seedDays", "Stop seeding after", s.seedDays, "days", "any")}
                ${this.numberField("ratioLimit", "or at share ratio", s.ratioLimit, "", "any")}
                <label>
                    <span>Then</span>
                    <select name="seedEndAction" .value=${s.seedEndAction}>
                        <option value="pause">Pause the torrent</option>
                        <option value="remove">Remove it from the list (keep files)</option>
                    </select>
                </label>
                <h4>Speed</h4>
                ${this.numberField("maxDownloadKiB", "Max download speed", s.maxDownloadKiB, "KiB/s")}
                ${this.numberField("maxUploadKiB", "Max upload speed", s.maxUploadKiB, "KiB/s")}
                <h4>Downloads</h4>
                ${this.numberField("maxActiveDownloads", "Max active downloads", s.maxActiveDownloads, "")}
                ${this.numberField("maxConnsPerTorrent", "Max connections per torrent", s.maxConnsPerTorrent, "", "1", "50")}
                <label class="dl-check">
                    <input name="sequentialByDefault" type="checkbox" .checked=${s.sequentialByDefault} />
                    New torrents download first &amp; last parts first, then in order
                </label>
                <label class="dl-check">
                    <input name="addPaused" type="checkbox" .checked=${s.addPaused} />
                    Add new torrents paused
                </label>
                <p class="dl-hint">Empty or 0 means no limit. Seeding limits count from when a torrent finished or was last resumed.
                    Torrents beyond the active download limit wait as Queued, oldest first.</p>
                ${this.settingsError ? html`<p class="dl-error">${this.settingsError}</p>` : nothing}
                <div class="dl-dialog-buttons">
                    <button type="button" @click=${() => (this.settings = null)}>Cancel</button>
                    <button type="submit" class="primary">Save</button>
                </div>
            </form>
        </div>`;
    }

    public render() {
        const tableWidth = COLUMN_KEYS.reduce((sum, k) => sum + this.width(k), 0);
        return html`<div class="downloads-page">
            ${this.renderFilters()}
            <div class="dl-table-wrap">
                <table class="dl-table" style="width: ${tableWidth}px">
                    <colgroup>${COLUMN_KEYS.map(k => html`<col style="width: ${this.width(k)}px" />`)}</colgroup>
                    <thead>${this.renderHeader()}</thead>
                    <tbody>${repeat(this.sorted, t => t.infoHash, t => this.renderRow(t))}</tbody>
                </table>
                ${this.loaded && !this.torrents.length
                    ? html`<div class="dl-empty">No torrents yet. Start one from a movie or episode's torrent list.</div>`
                    : this.loaded && !this.sorted.length
                    ? html`<div class="dl-empty">No ${FILTERS[this.prefs.filter].label.toLowerCase()} torrents.</div>`
                    : nothing}
            </div>
            ${this.renderDetails()}
            ${this.renderMenu()}
            ${this.renderDeleteDialog()}
            ${this.renderSettingsDialog()}
        </div>`;
    }
}
