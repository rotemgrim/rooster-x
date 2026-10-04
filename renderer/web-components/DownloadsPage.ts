import {LitElement, html, nothing, type TemplateResult} from "lit";
import {customElement, state} from "lit/decorators.js";
import {repeat} from "lit/directives/repeat.js";
import {EngineService, isVideo, largestVideo, type EngineState, type IEngineFile, type IEngineStatus} from "../services/engine.service";
import {formatBytes, formatDuration, formatSpeed, formatUnixDate} from "../common/commonUtils";
import {modal} from "./dialog";
import {playTorrentFile} from "./RemotePlayPicker";
import "./TorrentSettingsDialog";
import "./AddLinksDialog";
import {PHONE_QUERY} from "../common/layout";

type Torrent = IEngineStatus;

const POLL_MS = 1500;

/** The file's contents, base64 encoded. */
function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

const STATE_LABEL: Record<EngineState, string> = {
    metadata: "Downloading metadata",
    downloading: "Downloading",
    checking: "Checking",
    stalled: "Stalled",
    queued: "Queued",
    seeding: "Seeding",
    paused: "Paused",
    completed: "Completed",
};
const STATE_ICON: Record<EngineState, string> = {
    metadata: "south",
    downloading: "south",
    checking: "sync",
    stalled: "south",
    queued: "schedule",
    seeding: "done",
    paused: "pause",
    completed: "done",
};
// sort order of the Status column
const STATE_ORDER: EngineState[] = ["downloading", "checking", "metadata", "stalled", "queued", "seeding", "paused", "completed"];

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
    // the torrent shown in the details, and the anchor for shift-click
    @state() private selected = "";
    // the torrents the toolbar and menu act on (Ctrl/Shift-click for more)
    @state() private selection: ReadonlySet<string> = new Set();
    @state() private prefs: Prefs = loadPrefs();
    @state() private tab: "general" | "content" = "general";
    @state() private menu: {x: number; y: number; hashes: string[]} | null = null;
    @state() private deleting: {hashes: string[]; label: string; deleteFiles: boolean} | null = null;
    @state() private showSettings = false;
    @state() private showAddLinks = false;
    // why adding a .torrent file failed
    @state() private notice = "";
    // Phones get a card per torrent and a details sheet instead of the table.
    @state() private phone = false;
    private phoneQuery = window.matchMedia(PHONE_QUERY);
    private pollTimer: number | undefined;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.refresh();
        document.addEventListener("pointerdown", this.closeMenuOutside);
        document.addEventListener("keydown", this.onKey);
        this.phone = this.phoneQuery.matches;
        this.phoneQuery.addEventListener("change", this.onPhoneChange);
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        window.clearTimeout(this.pollTimer);
        document.removeEventListener("pointerdown", this.closeMenuOutside);
        document.removeEventListener("keydown", this.onKey);
        this.phoneQuery.removeEventListener("change", this.onPhoneChange);
    }

    private onPhoneChange = (e: MediaQueryListEvent) => {
        this.phone = e.matches;
    };

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

    /** The selected torrents the current filter shows, in list order. */
    private get targets(): Torrent[] {
        return this.sorted.filter(t => this.selection.has(t.infoHash));
    }

    private select(hashes: string[], focus = hashes[0] ?? "") {
        this.selection = new Set(hashes);
        this.selected = focus;
    }

    /** Click selects one row; Ctrl adds or removes one, Shift a range. */
    private clickRow(e: MouseEvent, t: Torrent) {
        const hash = t.infoHash;
        const add = e.ctrlKey || e.metaKey;
        if (e.shiftKey && this.selected) {
            const rows = this.sorted.map(r => r.infoHash);
            const from = rows.indexOf(this.selected);
            const to = rows.indexOf(hash);
            if (from >= 0) {
                const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
                // the anchor stays put
                this.selection = new Set(add ? [...this.selection, ...range] : range);
                return;
            }
        }
        if (add) {
            const next = new Set(this.selection);
            if (!next.delete(hash)) {
                next.add(hash);
            }
            this.selection = next;
            this.selected = hash;
        } else {
            this.select([hash]);
        }
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

    /** The menu acts on the selection, or on just t when focus is off (a
     * phone card's button, which shouldn't open the details sheet). */
    private openMenu(e: MouseEvent, t: Torrent, focus = true) {
        e.preventDefault();
        let hashes = [t.infoHash];
        if (focus) {
            if (this.selection.has(t.infoHash)) {
                this.selected = t.infoHash;
            } else {
                this.select(hashes);
            }
            hashes = this.targets.map(x => x.infoHash);
        }
        // keep the menu on screen
        this.menu = {x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 200), hashes};
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
            return;
        }
        const typing = e.target instanceof Element && e.target.closest("input, select, textarea");
        if (this.deleting || this.showAddLinks || this.showSettings || typing) {
            return;
        }
        if (e.key === "Delete" && this.targets.length) {
            this.askDelete(this.targets);
        } else if (e.key === "a" && (e.ctrlKey || e.metaKey) && !this.phone) {
            e.preventDefault();
            this.select(this.sorted.map(t => t.infoHash), this.selected);
        }
    };

    /** Runs action on every torrent in list, then refreshes. */
    private act(list: Torrent[], what: string, action: (t: Torrent) => Promise<unknown>) {
        this.menu = null;
        Promise.allSettled(list.map(action))
            .then(results => results.forEach(r => r.status === "rejected" && console.error(`could not ${what}`, r.reason)))
            .finally(() => this.refresh());
    }

    private setPaused(list: Torrent[], paused: boolean) {
        this.act(list.filter(t => t.paused !== paused), paused ? "pause" : "resume", t => EngineService.setPaused(t.infoHash, paused));
    }

    /** Turns sequential on for all of list, or off when all have it. */
    private toggleSequential(list: Torrent[]) {
        const on = !list.every(t => t.sequential);
        this.act(list, "change download order", t => EngineService.setSequential(t.infoHash, on));
    }

    private askDelete(list: Torrent[]) {
        this.menu = null;
        if (!list.length) {
            return;
        }
        const label = list.length === 1 ? `"${list[0].name || list[0].infoHash}"` : `these ${list.length} torrents`;
        this.deleting = {hashes: list.map(t => t.infoHash), label, deleteFiles: false};
    }

    private confirmDelete() {
        if (!this.deleting) {
            return;
        }
        const {hashes, deleteFiles} = this.deleting;
        this.deleting = null;
        this.selection = new Set([...this.selection].filter(h => !hashes.includes(h)));
        if (hashes.includes(this.selected)) {
            this.selected = "";
        }
        const list = this.torrents.filter(t => hashes.includes(t.infoHash));
        this.act(list, "delete torrent", t => EngineService.remove(t.infoHash, deleteFiles));
    }

    /** Adds .torrent files (picked or dropped); other files are skipped. */
    private async addFiles(files: FileList | null | undefined) {
        const list = Array.from(files ?? []).filter(f => f.name.toLowerCase().endsWith(".torrent"));
        const errors: string[] = [];
        let first = "";
        for (const file of list) {
            try {
                first ||= await EngineService.addTorrentFile(await readBase64(file));
            } catch (err) {
                errors.push(`${file.name}: ${err}`);
            }
        }
        this.notice = errors.join("\n");
        if (first) {
            this.onAdded(first);
        }
    }

    private onDrop(e: DragEvent) {
        if (e.dataTransfer?.files.length) {
            e.preventDefault();
            this.addFiles(e.dataTransfer.files);
        }
    }

    private play(t: Torrent, file = largestVideo(t.files)) {
        this.menu = null;
        if (file) {
            playTorrentFile(t.infoHash, file);
        }
    }

    /** Add, remove, resume and pause buttons; the last three act on the
     * selection, which phones don't have (their cards have a menu). */
    private renderToolbar() {
        const list = this.targets;
        const button = (cls: string, icon: string, title: string, onClick: () => void, enabled = true) =>
            html`<button class="${cls}" title=${title} ?disabled=${!enabled} @click=${onClick}><i class="material-icons">${icon}</i></button>`;
        return html`<div class="dl-toolbar">
            <input type="file" accept=".torrent,application/x-bittorrent" multiple hidden
                @change=${(e: Event) => {
                    const input = e.target as HTMLInputElement;
                    this.addFiles(input.files).finally(() => (input.value = ""));
                }} />
            ${button("tb-add", "add_circle", "Add torrent files",
                () => this.querySelector<HTMLInputElement>(".dl-toolbar input[type=file]")?.click())}
            ${button("tb-add", "add_link", "Add magnet links", () => (this.showAddLinks = true))}
            ${this.phone ? nothing : html`<span class="tb-separator"></span>
                ${button("tb-remove", "delete_forever", "Remove", () => this.askDelete(list), list.length > 0)}
                <span class="tb-separator"></span>
                ${button("tb-resume", "play_arrow", "Resume", () => this.setPaused(list, false), list.some(t => t.paused))}
                ${button("tb-pause", "stop", "Pause", () => this.setPaused(list, true), list.some(t => !t.paused))}`}
            <span class="tb-separator"></span>
            ${button("tb-settings", "settings", "BitTorrent settings", () => (this.showSettings = true))}
        </div>
        ${this.notice ? html`<div class="dl-notice">
            <span>${this.notice}</span>
            <button class="material-icons" title="Dismiss" @click=${() => (this.notice = "")}>close</button>
        </div>` : nothing}`;
    }

    private renderFilters() {
        return html`<div class="dl-filters">
            ${FILTERS.map(f => html`<button class="${this.prefs.filter === f.key ? "active" : ""}" @click=${() => this.savePrefs({filter: f.key})}>
                <i class="material-icons">${f.icon}</i>${f.label} (${this.torrents.filter(f.test).length})
            </button>`)}
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
        return html`<tr class="dl-row state-${t.state} ${this.selection.has(t.infoHash) ? "selected" : ""}"
            @click=${(e: MouseEvent) => this.clickRow(e, t)}
            @dblclick=${() => this.play(t)}
            @contextmenu=${(e: MouseEvent) => this.openMenu(e, t)}>
            ${COLUMNS.map(c => html`<td class="${c.numeric ? "num" : ""} col-${c.key}">${c.render(t)}</td>`)}
        </tr>`;
    }

    private renderMenu() {
        const menu = this.menu;
        const list = menu ? this.torrents.filter(x => menu.hashes.includes(x.infoHash)) : [];
        if (!menu || !list.length) {
            return nothing;
        }
        // only one torrent can play
        const video = list.length === 1 ? largestVideo(list[0].files) : undefined;
        return html`<ul class="dl-menu" style="left: ${menu.x}px; top: ${menu.y}px">
            ${list.some(t => t.paused)
                ? html`<li @click=${() => this.setPaused(list, false)}><i class="material-icons">play_arrow</i>Resume</li>`
                : nothing}
            ${list.some(t => !t.paused)
                ? html`<li @click=${() => this.setPaused(list, true)}><i class="material-icons">pause</i>Pause</li>`
                : nothing}
            <li class="${video ? "" : "disabled"}" @click=${() => video && this.play(list[0], video)}>
                <i class="material-icons">play_circle</i>Play
            </li>
            <li @click=${() => this.toggleSequential(list)}>
                <i class="material-icons">${list.every(t => t.sequential) ? "check_box" : "check_box_outline_blank"}</i>First &amp; last parts first, then in order
            </li>
            <li class="separator"></li>
            <li class="danger" @click=${() => this.askDelete(list)}>
                <i class="material-icons">delete</i>Delete${list.length > 1 ? ` ${list.length} torrents` : ""}…
            </li>
        </ul>`;
    }

    private renderDeleteDialog() {
        const deleting = this.deleting;
        if (!deleting) {
            return nothing;
        }
        return modal(() => (this.deleting = null), html`<div class="modal" role="dialog" aria-modal="true">
            <h3>Remove ${deleting.hashes.length > 1 ? "torrents" : "torrent"}</h3>
            <p>Are you sure you want to remove ${deleting.label} from the transfer list?</p>
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

    private onAdded(hash: string) {
        // on phones selecting opens the details sheet; leave them on the list
        if (!this.phone) {
            this.select([hash]);
        }
        this.refresh();
    }

    private renderDialogs() {
        return html`${this.showSettings ? html`<torrent-settings-dialog @close=${() => (this.showSettings = false)}></torrent-settings-dialog>` : nothing}
            ${this.showAddLinks ? html`<add-links-dialog @close=${() => (this.showAddLinks = false)}
                @added=${(e: CustomEvent<string>) => this.onAdded(e.detail)}></add-links-dialog>` : nothing}`;
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
                        ? html`<i class="material-icons dl-play" title="Play" @click=${() => this.play(t, f)}>play_circle</i>`
                        : nothing}</td>
                </tr>`)}
            </tbody>
        </table>`;
    }

    private renderCard(t: Torrent) {
        return html`<div class="dl-card state-${t.state}" @click=${() => (this.selected = t.infoHash)}>
            <div class="dl-card-name">
                <span class="dl-state-icon material-icons">${STATE_ICON[t.state]}</span><span>${t.name || t.infoHash}</span>
            </div>
            <button class="dl-card-more material-icons" title="Actions"
                @click=${(e: MouseEvent) => {
                    e.stopPropagation();
                    this.openMenu(e, t, false);
                }}>more_vert</button>
            ${progressBar(progress(t))}
            <div class="dl-card-stats">
                <span>${STATE_LABEL[t.state]}</span>
                ${t.hasInfo ? html`<span>${formatBytes(t.length)}</span>` : nothing}
                ${t.downSpeed ? html`<span>↓ ${formatSpeed(t.downSpeed)}</span>` : nothing}
                ${t.upSpeed ? html`<span>↑ ${formatSpeed(t.upSpeed)}</span>` : nothing}
                ${!t.done && t.eta >= 0 ? html`<span>${formatDuration(t.eta)} left</span>` : nothing}
            </div>
        </div>`;
    }

    private renderSheet() {
        const t = this.current;
        if (!t) {
            return nothing;
        }
        return html`<div class="dl-sheet-backdrop" @click=${(e: Event) => e.target === e.currentTarget && (this.selected = "")}>
            <div class="dl-sheet dl-details" role="dialog" aria-modal="true">
                <div class="dl-sheet-header">
                    <span class="dl-sheet-name">${t.name || t.infoHash}</span>
                    <button class="material-icons" title="Actions" @click=${(e: MouseEvent) => this.openMenu(e, t)}>more_vert</button>
                    <button class="material-icons" title="Close" @click=${() => (this.selected = "")}>close</button>
                </div>
                <div class="dl-tabs">
                    <button class="${this.tab === "general" ? "active" : ""}" @click=${() => (this.tab = "general")}>
                        <i class="material-icons">info</i>General
                    </button>
                    <button class="${this.tab === "content" ? "active" : ""}" @click=${() => (this.tab = "content")}>
                        <i class="material-icons">folder</i>Content
                    </button>
                </div>
                <div class="dl-details-body">
                    ${this.tab === "general" ? this.renderGeneral(t) : this.renderContent(t)}
                </div>
            </div>
        </div>`;
    }

    private renderPhone() {
        const rows = this.sorted;
        return html`<div class="downloads-page phone" @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${this.onDrop}>
            ${this.renderToolbar()}
            ${this.renderFilters()}
            <div class="dl-cards">
                ${repeat(rows, t => t.infoHash, t => this.renderCard(t))}
                ${!this.loaded ? nothing
                    : !this.torrents.length ? html`<div class="dl-empty">No torrents yet. Start one from a movie or episode's torrent list, add one with the buttons above, or drop .torrent files here.</div>`
                    : !rows.length ? html`<div class="dl-empty">No ${this.filter.label.toLowerCase()} torrents.</div>`
                    : nothing}
            </div>
            ${this.renderSheet()}
            ${this.renderMenu()}
            ${this.renderDeleteDialog()}
            ${this.renderDialogs()}
        </div>`;
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
        if (this.phone) {
            return this.renderPhone();
        }
        const tableWidth = COLUMNS.reduce((sum, c) => sum + this.width(c), 0);
        const rows = this.sorted;
        return html`<div class="downloads-page" @dragover=${(e: DragEvent) => e.preventDefault()} @drop=${this.onDrop}>
            ${this.renderToolbar()}
            ${this.renderFilters()}
            <div class="dl-table-wrap">
                <table class="dl-table" style="width: ${tableWidth}px">
                    <colgroup>${COLUMNS.map(c => html`<col style="width: ${this.width(c)}px" />`)}</colgroup>
                    <thead>${this.renderHeader()}</thead>
                    <tbody>${repeat(rows, t => t.infoHash, t => this.renderRow(t))}</tbody>
                </table>
                ${!this.loaded ? nothing
                    : !this.torrents.length ? html`<div class="dl-empty">No torrents yet. Start one from a movie or episode's torrent list, add one with the buttons above, or drop .torrent files here.</div>`
                    : !rows.length ? html`<div class="dl-empty">No ${this.filter.label.toLowerCase()} torrents.</div>`
                    : nothing}
            </div>
            ${this.renderDetails()}
            ${this.renderMenu()}
            ${this.renderDeleteDialog()}
            ${this.renderDialogs()}
        </div>`;
    }
}
