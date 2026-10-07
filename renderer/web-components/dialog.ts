import {html, type TemplateResult} from "lit";

/** A centred dialog over a dimmed backdrop; clicking the backdrop closes it. */
export function modal(onClose: () => void, body: TemplateResult) {
    return html`<div class="modal-backdrop" @click=${(e: Event) => e.target === e.currentTarget && onClose()}>
        ${body}
    </div>`;
}
