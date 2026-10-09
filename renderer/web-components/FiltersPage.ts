
import {LitElement, html} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {RoosterX} from "./RoosterX";
import {IpcService} from "../services/ipc.service";
import {type Genre} from "../entity/Genre";
import {isPhone} from "../common/layout";
import {type FilterConfig, type GroupBy, type LibraryQuery, type OrderConfig} from "../common/library";

type Toggle<T> = {[K in keyof T]: T[K] extends boolean ? K : never}[keyof T];

const ORDER_BY: [OrderConfig["orderBy"], string][] = [
    ["trendingCount", "Trending"],
    ["downloadedAt", "Download Date"],
    ["uploadedAt", "Uploaded Date"],
    ["rating", "IMDB Score"],
    ["votes", "IMDB Votes"],
    ["year", "Year"],
    ["released_unix", "Release Date"],
];

const GROUP_BY: [GroupBy, string][] = [
    ["none", "None"],
    ["rating", "IMDB Score"],
    ["resolution", "Resolution"],
    ["year", "Year"],
    ["genres", "Genres"],
    ["uploadedDate", "Uploaded Date"],
    ["downloadedDate", "Download Date"],
];

const ORDER_TOGGLES: [Toggle<OrderConfig>, string][] = [
    ["directionDescending", "Order direction descending"],
    ["showUnwatchedFirst", "Show unwatched first"],
];

const FILTER_TOGGLES: [Toggle<FilterConfig>, string][] = [
    ["unwatchedMedia", "Show ONLY unwatched media"],
    ["noMediaWithoutFiles", "Do not show media without files"],
    ["showDebug", "Show debug info on posters"],
];

@customElement("filters-page")
export class FiltersPage extends LitElement {

    @property({attribute: false}) public rooster: RoosterX;
    @property({attribute: false}) public query: LibraryQuery;
    @state() private genres: Genre[] = [];

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getAllGenres().then(genres => this.genres = genres);
    }

    private close() {
        this.rooster.closeSidePanel();
    }

    private setOrder(patch: Partial<OrderConfig>) {
        this.rooster.updateQuery({order: {...this.query.order, ...patch}});
    }

    private setFilters(patch: Partial<FilterConfig>) {
        this.rooster.updateQuery({filters: {...this.query.filters, ...patch}});
    }

    private setGenres(genres: string[]) {
        this.setFilters({noMediaWithoutGenres: genres});
    }

    /** Chips: "all" clears the selection, any other chip toggles. */
    private toggleGenre(genre: string) {
        const selected = this.query.filters.noMediaWithoutGenres;
        this.setGenres(genre === "all" ? []
            : selected.includes(genre) ? selected.filter(g => g !== genre)
            : [...selected, genre]);
    }

    /**
     * Multi-select: picking "All" clears the selection, but while "All" is
     * the current choice, adding genres to it (ctrl-click) picks those genres.
     */
    private selectGenres(values: string[]) {
        const wasAll = this.query.filters.noMediaWithoutGenres.length === 0;
        this.setGenres(values.includes("all") && !wasAll ? [] : values.filter(v => v !== "all"));
    }

    private renderGenres() {
        const selected = this.query.filters.noMediaWithoutGenres;
        const genres = [
            {value: "all", label: "All", active: selected.length === 0},
            ...this.genres.map(g => ({value: g.type.toLowerCase(), label: g.type, active: selected.includes(g.type.toLowerCase())})),
        ];
        if (isPhone()) {
            return html`<div class="genre-chips">
                ${genres.map(g => html`<button class="genre-chip ${g.active ? "active" : ""}"
                    @click=${() => this.toggleGenre(g.value)}>${g.label}</button>`)}
            </div>`;
        }
        return html`<select id="noMediaWithoutGenres" multiple
            @change=${(e: Event) => this.selectGenres([...(e.target as HTMLSelectElement).selectedOptions].map(o => o.value))}>
            ${genres.map(g => html`<option value="${g.value}" ?selected=${g.active}>${g.label}</option>`)}
        </select>`;
    }

    private renderToggle(id: string, label: string, checked: boolean, onChange: (checked: boolean) => void) {
        return html`<li>
            <h3>${label}</h3>
            <input @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)} id="${id}"
                ?checked="${checked}" class="tgl tgl-light" type="checkbox"/>
            <label class="tgl-btn" for="${id}"></label>
        </li>`;
    }

    public render() {
        const {order, filters} = this.query;
        return html`<div class="page filters-page">
            <div class="page-top">
                <h1>Choose Filters & Sorting</h1>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                <div>
                <div class="sorting">
                    <h2>Sorting</h2>
                    <ul>
                        <li>
                            <h3>Order by</h3>
                            <select id="orderBy" @change=${(e: Event) =>
                                this.setOrder({orderBy: (e.target as HTMLSelectElement).value as OrderConfig["orderBy"]})}>
                                ${ORDER_BY.map(([value, label]) =>
                                    html`<option ?selected=${order.orderBy === value} value="${value}">${label}</option>`)}
                            </select>
                        </li>
                        <li>
                            <h3>Group by</h3>
                            <select id="groupBy" @change=${(e: Event) =>
                                this.setOrder({groupBy: (e.target as HTMLSelectElement).value as GroupBy})}>
                                ${GROUP_BY.map(([value, label]) =>
                                    html`<option ?selected=${order.groupBy === value} value="${value}">${label}</option>`)}
                            </select>
                        </li>
                        ${ORDER_TOGGLES.map(([key, label]) =>
                            this.renderToggle(key, label, order[key], checked => this.setOrder({[key]: checked})))}
                    </ul>
                </div>
                <div class="filters-genres">
                    <h2>Filter by genre</h2>
                    ${this.renderGenres()}
                </div>
                <div class="filters">
                    <h2>Filters</h2>
                    <ul>
                        ${FILTER_TOGGLES.map(([key, label]) =>
                            this.renderToggle(key, label, filters[key], checked => this.setFilters({[key]: checked})))}
                    </ul>
                </div>
                </div>
            </div>
        </div>`;
    }
}
