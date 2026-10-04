import {LitElement, html, nothing} from "lit";
import {customElement, state} from "lit/decorators.js";
import {EngineService} from "../services/engine.service";
import {modal} from "./dialog";

// a bare info hash: v1 in hex or base32
const HASH = /^([0-9a-f]{40}|[a-z2-7]{32})$/i;

/** Adds magnet links. Fires "added" with the first torrent's info hash,
 * and "close". */
@customElement("add-links-dialog")
export class AddLinksDialog extends LitElement {

    @state() private links = "";
    @state() private busy = false;
    @state() private errors: string[] = [];

    public createRenderRoot() {
        return this;
    }

    public connectedCallback() {
        super.connectedCallback();
        document.addEventListener("keydown", this.onKey);
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("keydown", this.onKey);
    }

    protected firstUpdated() {
        this.querySelector("textarea")?.focus();
    }

    private onKey = (e: KeyboardEvent) => e.key === "Escape" && this.close();

    private close() {
        this.dispatchEvent(new CustomEvent("close"));
    }

    private get magnets(): string[] {
        return this.links.split(/\s+/).filter(Boolean).map(l => (HASH.test(l) ? `magnet:?xt=urn:btih:${l}` : l));
    }

    private async submit(e: Event) {
        e.preventDefault();
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.errors = [];
        const errors: string[] = [];
        const failed: string[] = [];
        let first = "";
        for (const magnet of this.magnets) {
            try {
                first ||= await EngineService.add(magnet);
            } catch (err) {
                failed.push(magnet);
                errors.push(`${magnet.length > 60 ? `${magnet.slice(0, 60)}…` : magnet}: ${err}`);
            }
        }
        this.busy = false;
        if (first) {
            this.dispatchEvent(new CustomEvent("added", {detail: first}));
        }
        if (!errors.length) {
            this.close();
            return;
        }
        // keep only what failed, to fix or retry
        this.links = failed.join("\n");
        this.errors = errors;
    }

    public render() {
        return modal(() => this.close(), html`<form class="modal add-links" role="dialog" aria-modal="true" @submit=${this.submit}>
            <h3>Add magnet links</h3>
            <textarea rows="5" placeholder="Magnet links or info hashes, one per line" spellcheck="false"
                .value=${this.links} @input=${(e: Event) => (this.links = (e.target as HTMLTextAreaElement).value)}></textarea>
            ${this.errors.length ? this.errors.map(err => html`<p class="dl-error">${err}</p>`) : nothing}
            <div class="modal-buttons">
                <button type="button" @click=${this.close}>Cancel</button>
                <button type="submit" class="primary" ?disabled=${!this.magnets.length || this.busy}>${this.busy ? "Adding…" : "Add"}</button>
            </div>
        </form>`);
    }
}
