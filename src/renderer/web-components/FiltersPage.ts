
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

    public render() {
        return html`<div class="page filters-page">
            <div class="page-top">
                <h1>Choose Filters & Sorting</h1>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                <div class="filters">
                    <h2>Filters</h2>
                    <ul>
                        <li>Show ONLY unwatched?</li>
                        <li>Show hint on poster for watched Media?</li>
                    </ul>
                </div>
                <div class="sorting">
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
