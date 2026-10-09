
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {type IFileMetaData} from "../common/models/IFileMetaData";
import {posterUrl} from "../common/library";

/**
 * The "Mark as watched?" prompt for what was just played. Shows nothing when
 * there is nothing to ask; the answer is an "answer" event (detail: true for
 * yes), and the owner clears the prompt.
 */
@customElement("did-watched")
export class DidWatched extends LitElement {

    @property({attribute: false}) public prompt: IFileMetaData | null = null;

    public createRenderRoot() {
        return this;
    }

    private answer(watched: boolean) {
        this.dispatchEvent(new CustomEvent<boolean>("answer", {detail: watched}));
    }

    private getData(u: IFileMetaData): {poster: string, title: string, titleHtml: any, plot: string} {
        if (u.episode) {
            // this is episode: title/plot are the series', episodeTitle/episodePlot its own
            const epiNumber = "S" + ("0" + u.season).slice(-2) + "-E" + ("0" + u.episode).slice(-2);
            return {
                poster: u.poster || "",
                title: u.title + " | " + epiNumber,
                titleHtml: html`<h1>${u.title}
                    <br>${epiNumber}${u.episodeTitle ? " | " + u.episodeTitle : ""}</h1>`,
                plot: u.episodePlot || u.plot || "",
            };
        }
        return {
            poster: u.poster || "",
            title: u.title || "",
            titleHtml: html`<h1>${u.title}</h1>`,
            plot: u.plot || "",
        };
    }

    public render() {
        if (!this.prompt || this.prompt.isWatched) {
            return html``;
        }

        const data = this.getData(this.prompt);
        if (!data.title) {
            return html``;
        }

        return html`<div class="did-you-watched">
            ${data.poster ?
                html`<img src="${posterUrl(data.poster)}" alt="${data.title}" />` :
                html`<div class="img-missing"><span>${data.title}</span></div>`}
            <div class="main">
                <h2>Mark as watched?</h2>
                ${data.titleHtml}
                <div class="confirm">
                    <button @click=${() => this.answer(true)} class="yes">Yes</button>
                    <button @click=${() => this.answer(false)} class="no">No</button>
                </div>
                <p>${data.plot}</p>
            </div>
        </div>`;
    }
}
