
import {LitElement, html} from "lit-element";

export class RoosterX extends LitElement {
    public render() {
        return html`<p>A paragraph</p>`;
    }
}

customElements.define("rooster-x", RoosterX);
