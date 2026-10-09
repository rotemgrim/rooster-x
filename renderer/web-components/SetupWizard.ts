import {LitElement, html, nothing} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {IpcService} from "../services/ipc.service";
import {type IDirListing, type ISetupConfig} from "../common/models/ISetup";
import {type User} from "../entity/User";
import "./UserProfiles";

/** Lets the user walk the server's disk and pick a folder. */
@customElement("folder-picker")
export class FolderPicker extends LitElement {

    @property() public pickLabel: string = "Use this folder";
    @property({attribute: false}) public onPick: (path: string) => void;

    @state() private listing: IDirListing = {path: "", parent: "", dirs: []};
    @state() private typed: string = "";
    @state() private error: string = "";
    @state() private loading: boolean = false;

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.open("");
    }

    private open(path: string) {
        this.loading = true;
        this.error = "";
        IpcService.setupListDirs(path)
            .then(listing => {
                this.listing = listing;
                this.typed = listing.path;
            })
            .catch(e => this.error = String(e))
            .finally(() => this.loading = false);
    }

    private name(path: string) {
        return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
    }

    public render() {
        const {path, parent, dirs} = this.listing;
        return html`<div class="folder-picker">
            <form class="fp-path" @submit=${(e: Event) => { e.preventDefault(); this.open(this.typed.trim()); }}>
                <button type="button" class="icon-btn" title="Up" ?disabled=${!path}
                        @click=${() => this.open(parent)}><i class="material-icons">arrow_upward</i></button>
                <input type="text" placeholder="Type or paste a folder path" .value=${this.typed}
                       @input=${(e: InputEvent) => this.typed = (e.target as HTMLInputElement).value}>
                <button type="submit" class="secondary">Go</button>
            </form>
            <div class="fp-list ${this.loading ? "loading" : ""}">
                ${dirs.length === 0 && !this.loading ? html`<div class="fp-empty">No folders here</div>` : nothing}
                ${dirs.map(d => html`<button type="button" class="fp-dir" @click=${() => this.open(d)}>
                    <i class="material-icons">folder</i><span>${path ? this.name(d) : d}</span>
                </button>`)}
            </div>
            ${this.error ? html`<p class="setup-error">${this.error}</p>` : nothing}
            <button type="button" class="primary" ?disabled=${!path} @click=${() => this.onPick(path)}>
                ${this.pickLabel}${path ? html`: <b>${this.name(path)}</b>` : nothing}
            </button>
        </div>`;
    }
}

type StepId = "welcome" | "tmdb" | "folders" | "downloads" | "schedules" | "iptv" | "users" | "review";

const STEPS: {id: StepId, title: string}[] = [
    {id: "welcome", title: "Welcome"},
    {id: "tmdb", title: "TMDB"},
    {id: "folders", title: "Media folders"},
    {id: "downloads", title: "Downloads"},
    {id: "schedules", title: "Schedules"},
    {id: "iptv", title: "Live TV"},
    {id: "users", title: "Users"},
    {id: "review", title: "Finish"},
];

const LANGUAGES = ["en-US", "he-IL", "es-ES", "fr-FR", "de-DE", "it-IT", "pt-BR", "ru-RU", "ja-JP"];

const ENRICH_PRESETS: [string, string][] = [
    ["0 2-3 * * *", "Every night at 02:00 and 03:00"],
    ["0 3 * * *", "Every night at 03:00"],
    ["0 */6 * * *", "Every 6 hours"],
    ["", "Never"],
];

const RATING_PRESETS: [string, string][] = [
    ["* * * * *", "Every minute"],
    ["*/5 * * * *", "Every 5 minutes"],
    ["0 * * * *", "Every hour"],
    ["", "Never"],
];

const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

/** "30 19 * * *" -> "19:30"; other cron expressions are shown as they are. */
function cronLabel(spec: string) {
    const m = spec.match(DAILY);
    return m ? `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}` : spec;
}

function timeToCron(time: string) {
    const [h, m] = time.split(":").map(Number);
    return `${m} ${h} * * *`;
}

function sortSchedules(specs: string[]) {
    return [...specs].sort((a, b) => cronLabel(a).localeCompare(cronLabel(b)));
}

/** First-run setup: walks through every config.yaml setting and the user list. */
@customElement("setup-wizard")
export class SetupWizard extends LitElement {

    @property({attribute: false}) public config: ISetupConfig;
    @property({attribute: false}) public onDone: () => void;

    @state() private step: number = 0;
    @state() private error: string = "";
    @state() private busy: boolean = false;
    @state() private checkedKey: string = "";
    @state() private customDownloadDir: boolean = false;
    // The users, as of leaving the users step, for the review.
    @state() private users: User[] = [];
    @state() private newTimes = {fullDirectoriesSweep: "", torrentsSweep: ""};

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        this.customDownloadDir = !!this.config.downloadDir;
    }

    private setField<K extends keyof ISetupConfig>(key: K, value: ISetupConfig[K]) {
        this.config = {...this.config, [key]: value};
        this.error = "";
    }

    private goTo(step: number) {
        this.error = "";
        this.step = step;
    }

    private async next() {
        this.error = "";
        try {
            this.busy = true;
            await this.checkStep(STEPS[this.step].id);
            if (this.step === STEPS.length - 1) {
                await IpcService.setupComplete(this.config);
                localStorage.removeItem("user");
                this.onDone();
                return;
            }
            this.step++;
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        } finally {
            this.busy = false;
        }
    }

    /** Throws the reason the user can't leave this step yet. */
    private async checkStep(id: StepId) {
        const c = this.config;
        switch (id) {
            case "tmdb": {
                const key = c.tmdbApiKey.trim();
                if (!key) throw new Error("Enter your TMDB API key");
                if (key !== this.checkedKey) {
                    await IpcService.setupCheckTmdbKey(key);
                    this.checkedKey = key;
                }
                if (!c.lang.trim()) throw new Error("Enter a language, for example en-US");
                break;
            }
            case "folders":
                if (c.directories.length === 0) throw new Error("Add at least one media folder");
                break;
            case "downloads":
                if (this.customDownloadDir && !c.downloadDir) throw new Error("Pick a downloads folder");
                if (!this.customDownloadDir) this.setField("downloadDir", "");
                break;
            case "iptv": {
                const {server, username, password} = c.xtream;
                const filled = [server, username, password].filter(v => v.trim()).length;
                if (filled > 0 && filled < 3) throw new Error("Fill in the server, username and password, or leave all three empty");
                break;
            }
            case "users":
                this.users = await IpcService.getAllUsers();
                if (this.users.length === 0) throw new Error("Add at least one user");
                break;
        }
    }

    private addDirectory(path: string) {
        if (!this.config.directories.includes(path)) {
            this.setField("directories", [...this.config.directories, path]);
        }
    }

    private renderWelcome() {
        return html`
            <h1>Welcome to RoosterX</h1>
            <p>RoosterX catalogs the movies and shows on your drives, finds new torrents for them and plays
                them on any device in the house.</p>
            <p>A few questions to set it up. You can change any of these later in <code>config.yaml</code>
                next to <code>roosterx.exe</code>.</p>`;
    }

    private renderTmdb() {
        const c = this.config;
        return html`
            <h1>The Movie Database</h1>
            <p>RoosterX recognizes every movie and episode with TMDB. Create a free account, then copy the
                <b>API Key</b> from <a href="https://www.themoviedb.org/settings/api" target="_blank"
                rel="noopener">themoviedb.org/settings/api</a>.</p>
            <label>API key
                <input type="text" spellcheck="false" autocomplete="off" .value=${c.tmdbApiKey}
                       @input=${(e: InputEvent) => this.setField("tmdbApiKey", (e.target as HTMLInputElement).value)}>
            </label>
            ${this.checkedKey && this.checkedKey === c.tmdbApiKey.trim()
                ? html`<p class="setup-ok"><i class="material-icons">check_circle</i> TMDB accepted this key</p>` : nothing}
            <label>Language for titles and plots
                <input type="text" list="setup-langs" .value=${c.lang}
                       @input=${(e: InputEvent) => this.setField("lang", (e.target as HTMLInputElement).value)}>
                <datalist id="setup-langs">${LANGUAGES.map(l => html`<option value=${l}></option>`)}</datalist>
            </label>`;
    }

    private renderFolders() {
        const dirs = this.config.directories;
        return html`
            <h1>Media folders</h1>
            <p>The folders that hold your movies and shows. RoosterX scans them, including every subfolder,
                and watches them for new files.</p>
            <ul class="setup-list">
                ${dirs.length === 0 ? html`<li class="empty">No folders yet</li>` : nothing}
                ${dirs.map(d => html`<li><i class="material-icons">folder</i><span>${d}</span>
                    <button class="icon-btn" title="Remove"
                            @click=${() => this.setField("directories", dirs.filter(x => x !== d))}>
                        <i class="material-icons">close</i></button></li>`)}
            </ul>
            <folder-picker pickLabel="Add" .onPick=${(p: string) => this.addDirectory(p)}></folder-picker>`;
    }

    private renderDownloads() {
        const c = this.config;
        const first = c.directories[0];
        return html`
            <h1>Downloads</h1>
            <p>Where the built-in torrent client saves what you download. Keep it inside one of your media
                folders so finished downloads show up in the library.</p>
            <label class="radio"><input type="radio" name="dl" .checked=${!this.customDownloadDir}
                    @change=${() => this.customDownloadDir = false}>
                The first media folder <code>${first}</code></label>
            <label class="radio"><input type="radio" name="dl" .checked=${this.customDownloadDir}
                    @change=${() => this.customDownloadDir = true}>
                Another folder${c.downloadDir && this.customDownloadDir ? html`: <code>${c.downloadDir}</code>` : nothing}</label>
            ${this.customDownloadDir
                ? html`<folder-picker .onPick=${(p: string) => this.setField("downloadDir", p)}></folder-picker>`
                : nothing}`;
    }

    private renderTimes(key: "fullDirectoriesSweep" | "torrentsSweep", title: string, hint: string) {
        const specs = this.config[key];
        const time = this.newTimes[key];
        const add = () => {
            if (!time) return;
            const spec = timeToCron(time);
            if (!specs.includes(spec)) this.setField(key, sortSchedules([...specs, spec]));
            this.newTimes = {...this.newTimes, [key]: ""};
        };
        return html`<div class="setup-field">
            <h3>${title}</h3>
            <p class="hint">${hint}</p>
            <div class="chips">
                ${specs.length === 0 ? html`<span class="empty">Never</span>` : nothing}
                ${specs.map(s => html`<span class="chip">${cronLabel(s)}
                    <button class="icon-btn" title="Remove" @click=${() => this.setField(key, specs.filter(x => x !== s))}>
                        <i class="material-icons">close</i></button></span>`)}
                <span class="add-time">
                    <input type="time" .value=${time}
                           @input=${(e: InputEvent) => this.newTimes = {...this.newTimes, [key]: (e.target as HTMLInputElement).value}}>
                    <button class="secondary" ?disabled=${!time} @click=${add}>Add</button>
                </span>
            </div>
        </div>`;
    }

    private renderPreset(key: "metadataEnrichPoll" | "imdbRatingPoll", presets: [string, string][], title: string, hint: string) {
        const value = this.config[key];
        const options = presets.some(([v]) => v === value) ? presets : [...presets, [value, `Custom: ${value}`]];
        return html`<div class="setup-field">
            <h3>${title}</h3>
            <p class="hint">${hint}</p>
            <select @change=${(e: Event) => this.setField(key, (e.target as HTMLSelectElement).value)}>
                ${options.map(([v, label]) => html`<option value=${v} ?selected=${v === value}>${label}</option>`)}
            </select>
        </div>`;
    }

    private renderSchedules() {
        return html`
            <h1>Schedules</h1>
            <p>When RoosterX does its background work. New files in your folders are picked up right away
                either way; the full scan catches anything missed.</p>
            ${this.renderTimes("fullDirectoriesSweep", "Full scan of the media folders",
                "Re-reads every folder and identifies new files.")}
            ${this.renderTimes("torrentsSweep", "Look for new torrents",
                "Checks for new releases of what's in your library.")}
            ${this.renderPreset("metadataEnrichPoll", ENRICH_PRESETS, "Fill in missing details",
                "Fetches posters, plots and cast from TMDB for titles that are missing them.")}
            ${this.renderPreset("imdbRatingPoll", RATING_PRESETS, "Fill in missing IMDb ratings",
                "Rates one title per run.")}`;
    }

    private renderIptv() {
        const x = this.config.xtream;
        const set = (field: keyof typeof x) => (e: InputEvent) =>
            this.setField("xtream", {...x, [field]: (e.target as HTMLInputElement).value});
        return html`
            <h1>Live TV <span class="optional">optional</span></h1>
            <p>If you have an IPTV subscription with Xtream Codes login details, fill them in to watch its
                channels in RoosterX. Leave everything empty to skip.</p>
            <label>Server
                <input type="url" placeholder="http://example.com:8080" .value=${x.server} @input=${set("server")}>
            </label>
            <label>Username
                <input type="text" autocomplete="off" .value=${x.username} @input=${set("username")}>
            </label>
            <label>Password
                <input type="password" autocomplete="off" .value=${x.password} @input=${set("password")}>
            </label>`;
    }

    private renderUsers() {
        return html`
            <h1>Users</h1>
            <p>Everyone in the house can have a profile with their own watched history and lists. You pick a
                profile when you open RoosterX. A profile with an age limit only sees movies and series rated for
                that age, nothing unrated, and has no Downloads.</p>
            <user-profiles></user-profiles>`;
    }

    private renderReview() {
        const c = this.config;
        const row = (step: StepId, label: string, value: unknown) => html`<tr>
            <th>${label}</th><td>${value}</td>
            <td><button class="link" @click=${() => this.goTo(STEPS.findIndex(s => s.id === step))}>Edit</button></td>
        </tr>`;
        const times = (specs: string[]) => specs.length ? specs.map(cronLabel).join(", ") : "Never";
        const preset = (presets: [string, string][], v: string) => presets.find(([p]) => p === v)?.[1] ?? v;
        return html`
            <h1>All set</h1>
            <p>Check everything below, then start RoosterX. It begins scanning your folders right away.</p>
            <table class="review">
                ${row("tmdb", "TMDB key", c.tmdbApiKey.slice(0, 6) + "…")}
                ${row("tmdb", "Language", c.lang)}
                ${row("folders", "Media folders", html`${c.directories.map(d => html`<div>${d}</div>`)}`)}
                ${row("downloads", "Downloads", c.downloadDir || c.directories[0])}
                ${row("schedules", "Full scan", times(c.fullDirectoriesSweep))}
                ${row("schedules", "Torrents", times(c.torrentsSweep))}
                ${row("schedules", "Missing details", preset(ENRICH_PRESETS, c.metadataEnrichPoll))}
                ${row("schedules", "IMDb ratings", preset(RATING_PRESETS, c.imdbRatingPoll))}
                ${row("iptv", "Live TV", c.xtream.server || "Off")}
                ${row("users", "Users", this.users.map(u => u.firstName).join(", "))}
            </table>`;
    }

    public render() {
        const id = STEPS[this.step].id;
        const body = {
            welcome: () => this.renderWelcome(),
            tmdb: () => this.renderTmdb(),
            folders: () => this.renderFolders(),
            downloads: () => this.renderDownloads(),
            schedules: () => this.renderSchedules(),
            iptv: () => this.renderIptv(),
            users: () => this.renderUsers(),
            review: () => this.renderReview(),
        }[id]();
        const last = this.step === STEPS.length - 1;
        return html`<div class="setup-page">
            <div class="setup-card">
                <ol class="setup-steps">
                    ${STEPS.map((s, i) => html`<li class="${i === this.step ? "current" : i < this.step ? "done" : ""}"
                            @click=${() => i < this.step && this.goTo(i)}>
                        <span class="num">${i < this.step ? html`<i class="material-icons">check</i>` : i + 1}</span>
                        <span class="title">${s.title}</span>
                    </li>`)}
                </ol>
                <div class="setup-body">${body}</div>
                ${this.error ? html`<p class="setup-error">${this.error}</p>` : nothing}
                <div class="setup-nav">
                    ${this.step > 0 ? html`<button class="secondary" ?disabled=${this.busy}
                            @click=${() => this.goTo(this.step - 1)}>Back</button>` : html`<span></span>`}
                    <button class="primary" ?disabled=${this.busy} @click=${this.next}>
                        ${this.busy ? "Checking…" : last ? "Start RoosterX" : this.step === 0 ? "Get started" : "Next"}
                    </button>
                </div>
            </div>
        </div>`;
    }
}
