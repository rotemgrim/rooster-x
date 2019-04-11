
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
        this.rooster._panel = "";
    }

    private filterChange(e) {
        const addToFilterConfig = {};
        addToFilterConfig[e.target.id] = e.target.checked;
        this.rooster.filterConfig = Object.assign(this.rooster._filterConfig, addToFilterConfig);
    }

    public render() {
        return html`<div class="page filters-page">
            <div class="page-top">
                <h1>Choose Filters & Sorting</h1>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                <div class="filters">
                    <br><br><br><br>
                    <h2>Filters</h2>
                    <ul>
                        <li>
                            <h3>Show ONLY unwatched media</h3>
                            <input @change=${this.filterChange} id="unwatchedMedia"
                                class="tgl tgl-light" type="checkbox"/>
                            <label class="tgl-btn" for="unwatchedMedia"></label>
                        </li>
                        <!--<li>-->
                            <!--<h3>Show watched hint on poster for watched Media</h3>-->
                            <!--<input class="tgl tgl-light" id="cb2" type="checkbox"/>-->
                            <!--<label class="tgl-btn" for="cb2"></label>-->
                        <!--</li>-->
                    </ul>
                </div>
                <div class="sorting">
                    <br><br><br><br>
                    <h2>Sorting</h2>
                    <ul>
                        <li>Order by Downloaded date & time</li>
                        <li>Order by IMDB Score</li>
                        <li>Order by IMDB Votes</li>
                        <li>Order by IMDB Votes</li>
                    </ul>
                </div>
            </div>
        </div>`;
    }
}
