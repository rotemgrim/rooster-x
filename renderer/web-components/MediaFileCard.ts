
import {LitElement, html} from "lit";
import {customElement, property} from "lit/decorators.js";
import {type MediaFile} from "../entity/MediaFile";
import {IpcService} from "../services/ipc.service";

@customElement("media-file-card")
export class MediaFileCard extends LitElement {

    @property() public mediaFile: MediaFile;

    public createRenderRoot() {
        return this;
    }

    constructor() {
        super();
    }

    public playFile() {
        this.dispatchEvent(new CustomEvent("playMedia", {detail: this.mediaFile}));
    }

    public static fileOptions(file: MediaFile) {
        return html`<span>${file.raw}</span>`;
    }

    private showInFolder() {
        // get the directory path on the os (support for windows and linux)
        let dirPath = this.mediaFile.path.substring(0, this.mediaFile.path.lastIndexOf("/"));
        if (dirPath === "") {
            dirPath = this.mediaFile.path.substring(0, this.mediaFile.path.lastIndexOf("\\"));
        }
        IpcService.openExternal(dirPath);
        // shell.showItemInFolder(this.mediaFile.path);
        console.log("show in folder", dirPath);
    }

    /**
     * Map a release-quality string (WEB-DL, BluRay, TS, HDTV, …) to a CSS
     * tier class so styling can communicate source quality at a glance.
     */
    public static qualityTier(q?: string | null): string {
        if (!q) return "";
        const v = q.toString().toUpperCase().replace(/[\s._-]/g, "");
        if (/(BLURAY|BDRIP|BRRIP|REMUX|UHD)/.test(v)) return "tier-great";
        if (/(WEBDL|WEBRIP|WEB)/.test(v)) return "tier-good";
        if (/(HDTV|HDRIP|DVDRIP|DVD|PDTV)/.test(v)) return "tier-ok";
        if (/(HDTS|TS|CAM|TC|TELESYNC|TELECINE|SCREENER|SCR)/.test(v)) return "tier-bad";
        return "";
    }

    /**
     * Map a resolution string (2160p, 1080p, 720p, …) to a tier class so the
     * chip color reflects picture quality. 1080p uses the default chip color.
     */
    public static resolutionTier(r?: string | null): string {
        if (!r) return "";
        const v = r.toString().toUpperCase().replace(/[\s._-]/g, "");
        if (/(4320P|8K)/.test(v)) return "res-8k";
        if (/(2160P|4K|UHD)/.test(v)) return "res-4k";
        if (/720P/.test(v)) return "res-720";
        if (/(480P|576P|SD)/.test(v)) return "res-sd";
        return "";
    }

    public render() {
        const qTier = MediaFileCard.qualityTier(this.mediaFile.quality);
        const rTier = MediaFileCard.resolutionTier(this.mediaFile.resolution);
        return html`<div tabindex="0" @click=${this.playFile} class="media-file" title="${this.mediaFile.path}">
            <i class="material-icons">play_circle_outline</i>
            ${this.mediaFile.resolution ? html`<div class="resolution ${rTier}">${this.mediaFile.resolution}</div>` : ""}
            ${this.mediaFile.audio ? html`<div class="audio">${this.mediaFile.audio}</div>` : ""}
            ${this.mediaFile.quality ? html`<div class="quality ${qTier}">${this.mediaFile.quality}</div>` : ""}
            ${this.mediaFile.raw ? html`<div class="raw">${this.mediaFile.raw}</div>` : ""}
        </div>
        <div class="buttons">
            <div class="open-folder" tabindex="0" @click=${this.showInFolder} >
                <i class="material-icons">folder</i>
            </div>
        </div>`;
    }
}
