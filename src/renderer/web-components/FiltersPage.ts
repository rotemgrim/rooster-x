
import {css, LitElement, html, customElement, property} from "lit-element";
import {RoosterX} from "./RoosterX";
import "./multiselect.html";
import {IpcService} from "../services/ipc.service";
import {Genre} from "../../entity/Genre";

@customElement("filters-page")
export class FiltersPage extends LitElement {

    @property() public rooster: RoosterX;
    @property() public _genres: Genre[] = [];

    public createRenderRoot() {
        return this;
    }

    set genres(data) {
        this._genres = data;
        this.requestUpdate();
    }

    constructor() {
        super();
        IpcService.getAllGenres().then(genres => this.genres = genres);
    }

    private close() {
        this.rooster.closeSideBar();
    }

    private filterChange(e) {
        const addToFilterConfig = {};
        addToFilterConfig[e.target.id] = e.target.checked;
        this.rooster.filterConfig = Object.assign(this.rooster._filterConfig, addToFilterConfig);
    }

    private filterGenreChange(e) {
        const addToFilterConfig = {};
        console.log(e);
        console.log(e.target.options);
        let selectedArr: string[] = [];
        for (const o of e.target.options) {
            if (o.selected && o.value && o.value === "All") {
                selectedArr = [];
                break;
            }
            if (o.selected && o.value) {
                selectedArr.push(o.value.toLowerCase());
            }
        }
        console.log("selectedArr", selectedArr);
        addToFilterConfig[e.target.id] = selectedArr;
        this.rooster.filterConfig = Object.assign(this.rooster._filterConfig, addToFilterConfig);
    }

    private orderDirectrionChange(e) {
        const addToOrderConfig = {};
        addToOrderConfig[e.target.id] = e.target.checked;
        this.rooster.orderConfig = Object.assign(this.rooster._orderConfig, addToOrderConfig);
    }

    private orderByChange(e) {
        const addToOrderConfig = {};
        addToOrderConfig[e.target.id] = e.target.value;
        this.rooster.orderConfig = Object.assign(this.rooster._orderConfig, addToOrderConfig);
    }

    public render() {
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
                            <select @change=${this.orderByChange} id="orderBy">
                                <option ?selected=${this.rooster._orderConfig.orderBy === "latestChange"}
                                    value="latestChange">Download Date</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "rating"}
                                    value="rating">IMDB Score</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "votes"}
                                    value="votes">IMDB Votes</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "year"}
                                    value="year">Year</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "released_unix"}
                                    value="released_unix">Release Date</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "runtime"}
                                    value="runtime">Runtime</option>
                                <option ?selected=${this.rooster._orderConfig.orderBy === "status"}
                                    value="status">Status</option>
                            </select>
                        </li>
                        <li>
                            <h3>Order direction descending</h3>
                            <input @change=${this.orderDirectrionChange} id="directionDescending"
                                ?checked="${this.rooster._orderConfig.directionDescending}"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="directionDescending"></label>
                        </li>
                        <li>
                            <h3>Show unwatched first</h3>
                            <input @change=${this.orderDirectrionChange} id="showUnwatchedFirst"
                                ?checked="${this.rooster._orderConfig.showUnwatchedFirst}"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="showUnwatchedFirst"></label>
                        </li>
                    </ul>
                </div>
                <div class="filters-genres">
                    <h2>Filter by genre</h2>
                    <select id="noMediaWithoutGenres" multiple @change=${this.filterGenreChange}>
                        <option value="All"
                            ?selected=${this.rooster._filterConfig.noMediaWithoutGenres.includes("All")}>
                            All</option>
                        ${this._genres.map(g =>
                            html`<option value="${g.type}"
                                ?selected=${this.rooster._filterConfig.noMediaWithoutGenres
                                    .includes(g.type.toLowerCase())}>
                                ${g.type}</option>`)}
                    </select>
                </div>
                <div class="filters">
                    <h2>Filters</h2>
                    <ul>
                        <li>
                            <h3>Show ONLY unwatched media</h3>
                            <input @change=${this.filterChange} id="unwatchedMedia"
                                ?checked="${this.rooster._filterConfig.unwatchedMedia}"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="unwatchedMedia"></label>
                        </li>
                        <li>
                            <h3>Do not show media without files</h3>
                            <input @change=${this.filterChange} id="noMediaWithoutFiles"
                                ?checked="${this.rooster._filterConfig.noMediaWithoutFiles}"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="noMediaWithoutFiles"></label>
                        </li>
                        <li>
                            <h3>Do not show media without full description</h3>
                            <input @change=${this.filterChange} id="noMediaWithoutMetaData"
                                ?checked="${this.rooster._filterConfig.noMediaWithoutMetaData}"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="noMediaWithoutMetaData"></label>
                        </li>
                    </ul>
                </div>
                </div>
            </div>
        </div>`;
    }
}
