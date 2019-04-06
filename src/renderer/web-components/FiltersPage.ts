
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
                <h2>Choose Filters & Sorting</h2>
                <div class="close" @click=${this.close}>X</div>
            </div>
            <div class="page-body">
                some options
            </div>
        </div>`;
    }
}
