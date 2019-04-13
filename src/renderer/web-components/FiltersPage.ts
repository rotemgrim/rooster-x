
import {css, LitElement, html, customElement, property} from "lit-element";
import {RoosterX} from "./RoosterX";

@customElement("filters-page")
export class FiltersPage extends LitElement {

    @property() public rooster: RoosterX;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    private close() {
        this.rooster.closeSideBar();
    }

    private filterChange(e) {
        const addToFilterConfig = {};
        addToFilterConfig[e.target.id] = e.target.checked;
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
                <div class="sorting">
                    <br><br><br><br>
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
                                <option ?selected=${this.rooster._orderConfig.orderBy === "released"}
                                    value="released">Release Date</option>
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
                    </ul>
                </div>
                <div class="filters">
                    <br><br><br><br>
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
        </div>`;
    }
}
