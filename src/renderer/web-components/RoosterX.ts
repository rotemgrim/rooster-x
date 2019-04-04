
import {css, LitElement, html, customElement, property} from "lit-element";
import {IpcService} from "../services/ipc.service";
import "./VideoCard";

@customElement("rooster-x")
export class RoosterX extends LitElement {

    @property() public _media = [];

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        IpcService.getConfig().then(console.log);
        IpcService.getAllMedia().then(media => this.media = media);
    }

    set media(data) {
        this._media = data;
        console.log(data);
        this.requestUpdate();
    }

    public render() {
        return html`<div class="top-bar">
            <div class="logo">
                <img src="../images/angry-rooster.jpg" alt="">
            </div>
        </div>
        <div class="side-bar">
            some stuff
        </div>
        <div class="videos">
            ${this._media.map(v => html`<video-card .video=${v}></video-card>`)}
        </div>`;
    }
}
