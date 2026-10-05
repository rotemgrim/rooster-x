import {html, LitElement, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {type MediaFile} from "../entity/MediaFile";
import {EngineService, type IEngineFile} from "../services/engine.service";
import {IpcService} from "../services/ipc.service";

/** Something to play: a library file or a torrent's file while it downloads. */
export interface PlaySource {
    title: string;
    /** Same-origin URL path the server streams it from, with Range support. */
    path: string;
    /**
     * The file's path on the server, for the SMB hand-off. Unset for torrent
     * streams: the file on disk is incomplete, and only the HTTP stream
     * waits for missing pieces.
     */
    serverPath?: string;
}

/**
 * A "remote" client is any session where the web UI wasn't loaded from the
 * local machine, i.e. a phone, tablet or other desktop on the LAN hitting
 * http://<pc-ip>:8080. It can't shell out to mpv (that would launch it on
 * the server PC), so it gets the picker instead.
 */
function isRemoteClient(): boolean {
    const host = window.location?.hostname;
    // file:// (Electron packaged app) has hostname "": local.
    return !!host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

/** Plays on this device: the picker on a remote client, else playOnHost. */
export function playOnDevice(source: PlaySource, playOnHost: () => void) {
    if (!isRemoteClient()) {
        playOnHost();
        return;
    }
    const picker = document.createElement("remote-play-picker") as RemotePlayPicker;
    picker.source = source;
    picker.open = true;
    picker.addEventListener("close", () => picker.remove());
    document.body.appendChild(picker);
}

export function mediaFileSource(file: MediaFile): PlaySource {
    const raw = file.path || file.raw || "";
    const base = raw.split(/[\\/]/).pop() || `media-${file.id}`;
    return {title: file.raw || file.path || "", path: `/file/${file.id}/${encodeURIComponent(base)}`, serverPath: raw};
}

/** Plays a torrent's file while it downloads. */
export function playTorrentFile(infoHash: string, file: IEngineFile) {
    const path = EngineService.streamPath(infoHash, file);
    playOnDevice({title: file.path.split("/").pop() || file.path, path}, () =>
        // plain http on the same host the UI was opened from; mpv rejects the
        // self-signed cert used on :8443
        IpcService.openInMPV(`http://${location.hostname}:8080${path}`));
}

/**
 * Remote playback sheet. Shown when a non-local client (phone or another
 * desktop on the LAN) taps Play.
 *
 * Options offered:
 *   1. Open in VLC - `vlc://<httpUrl>` deep-link. Primary, works reliably
 *      on Android + iOS when VLC is installed.
 *   2. Open in browser - navigate to the raw stream URL and let the
 *      browser play it inline. Good for MP4/H.264+AAC sources.
 *   3. Copy URL fallback for VLC's "Open Network Stream" screen.
 *
 * The Web Share API path was removed because VLC's ACTION_SEND handler
 * mis-interprets the shared URL and plays a ~3-second placeholder instead
 * of streaming the file.
 *
 * Dispatches a "close" event when dismissed; playOnDevice() shows it.
 */
@customElement("remote-play-picker")
export class RemotePlayPicker extends LitElement {

    @property({attribute: false}) public source!: PlaySource;
    @property({type: Boolean, reflect: true}) public open: boolean = false;

    @state() private httpUrl: string = "";
    @state() private copied: boolean = false;
    @state() private showSmbConfig: boolean = false;
    @state() private serverPrefix: string = localStorage.getItem("rooster.mpv.serverPrefix") || "";
    @state() private clientPrefix: string = localStorage.getItem("rooster.mpv.clientPrefix") || "";

    private static readonly LS_SERVER_PREFIX = "rooster.mpv.serverPrefix";
    private static readonly LS_CLIENT_PREFIX = "rooster.mpv.clientPrefix";

    static styles = css`
        :host {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: rgba(0, 0, 0, 0.75);
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            color: #e8eaed;
        }
        :host([open]) { display: flex; }

        .sheet {
            background: #14171c;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 1.25rem;
            width: min(560px, 92vw);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
        }
        h3 { margin: 0 0 0.25rem; font-size: 1.05rem; }
        .sub { color: #a8aeb8; font-size: 0.85rem; margin-bottom: 1rem; word-break: break-all; }

        button.choice {
            width: 100%;
            appearance: none;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: #1c2027;
            color: inherit;
            padding: 0.85rem 1rem;
            border-radius: 8px;
            text-align: left;
            cursor: pointer;
            font-size: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
            transition: background 0.15s ease, border-color 0.15s ease;
            margin-bottom: 0.5rem;
        }
        button.choice:hover { background: #262b34; border-color: #ff3344; }
        button.choice .hint { color: #a8aeb8; font-size: 0.8rem; }
        button.choice.primary { border-color: #ff3344; background: #1f1014; }

        .fallback {
            margin-top: 0.5rem;
            padding: 0.75rem;
            background: #0f1216;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
        }
        .fallback-label { color: #a8aeb8; font-size: 0.8rem; margin-bottom: 0.5rem; }
        .fallback-url {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .fallback-url code {
            flex: 1;
            font-size: 0.8rem;
            word-break: break-all;
            color: #e8eaed;
            background: #14171c;
            padding: 0.4rem 0.5rem;
            border-radius: 6px;
        }
        button.copy {
            appearance: none;
            background: #262b34;
            color: #e8eaed;
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0.4rem 0.7rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            white-space: nowrap;
        }
        button.copy:hover { background: #ff3344; border-color: #ff3344; }

        .smb-config {
            margin-top: 0.5rem;
            padding: 0.75rem;
            background: #0f1216;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .smb-config label {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            font-size: 0.8rem;
            color: #a8aeb8;
        }
        .smb-config input {
            background: #14171c;
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #e8eaed;
            padding: 0.4rem 0.5rem;
            border-radius: 6px;
            font-size: 0.85rem;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .smb-config .preview { color: #a8aeb8; font-size: 0.75rem; word-break: break-all; }
        .smb-config .preview code { color: #e8eaed; }
        button.link {
            appearance: none;
            background: transparent;
            border: none;
            color: #a8aeb8;
            font-size: 0.8rem;
            cursor: pointer;
            padding: 0.25rem 0;
            text-align: left;
            text-decoration: underline;
        }
        button.link:hover { color: #ff3344; }

        .actions { display: flex; justify-content: flex-end; margin-top: 1rem; gap: 0.5rem; }
        button.close {
            appearance: none;
            background: transparent;
            color: #a8aeb8;
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0.5rem 0.9rem;
            border-radius: 6px;
            cursor: pointer;
        }
        button.close:hover { color: #fff; border-color: #ff3344; }
    `;

    public render() {
        if (!this.open || !this.source) return html``;
        if (!this.httpUrl) this.httpUrl = this.buildFileUrl();

        return html`
            <div class="sheet" @click=${(e: Event) => e.stopPropagation()}>
                <h3>Play on this device</h3>
                <div class="sub">${this.source.title}</div>

                <button class="choice primary" @click=${this.openInVlc}>
                    <span>Open in VLC</span>
                    <span class="hint">Direct hand-off to VLC via the vlc:// link.</span>
                </button>

                <button class="choice" @click=${this.openInMpv}>
                    <span>Open in mpv</span>
                    <span class="hint">Hand off to mpv via the mpv:// scheme (requires an mpv:// handler).</span>
                </button>

                <button class="choice" @click=${this.openInMpvSmb} ?disabled=${!this.canUseSmb()}>
                    <span>Open in mpv (SMB)</span>
                    <span class="hint">
                        ${this.canUseSmb()
                            ? html`Translate server path to a mapped drive and hand off to mpv://.`
                            : html`Configure path mapping below to enable.`}
                    </span>
                </button>

                <button class="link" @click=${() => { this.showSmbConfig = !this.showSmbConfig; }}>
                    ${this.showSmbConfig ? "▾" : "▸"} Configure SMB path mapping
                </button>
                ${this.showSmbConfig ? this.renderSmbConfig() : null}

                <button class="choice" @click=${this.openViaIntent}>
                    <span>Open via Android Intent</span>
                    <span class="hint">Chrome-style intent:// URL pinned to VLC's Android package.</span>
                </button>

                <button class="choice" @click=${this.openInLibmedia}>
                    <span>Play in page (libmedia)</span>
                    <span class="hint">WebAssembly player. Decodes AC3/E-AC3/DTS audio the browser can't.</span>
                </button>

                <button class="choice" @click=${this.openInBrowser}>
                    <span>Open in browser</span>
                    <span class="hint">Play inline in this tab. Works for MP4/H.264+AAC; audio may be missing for MKV with AC3/DTS.</span>
                </button>

                <div class="fallback">
                    <div class="fallback-label">Or paste this URL into
                        VLC → More → Open Network Stream:</div>
                    <div class="fallback-url">
                        <code>${this.httpUrl}</code>
                        <button class="copy" @click=${this.copyUrl}>
                            ${this.copied ? "Copied!" : "Copy"}
                        </button>
                    </div>
                </div>

                <div class="actions">
                    <button class="close" @click=${this.close}>Close</button>
                </div>
            </div>
        `;
    }

    /**
     * Navigate the current tab to the raw stream URL. The browser's
     * built-in handler takes over: modern Chrome/Safari will render an
     * inline <video> element. Works great for MP4/H.264+AAC sources;
     * audio may be missing for MKV containers with AC3/DTS tracks.
     */
    private openInBrowser = () => {
        const httpUrl = this.httpUrl || this.buildFileUrl();
        console.log("Opening inline in browser:", httpUrl);
        this.handOff(httpUrl);
    };

    /**
     * Open the libmedia player page. The file is passed as a path so it
     * stays same-origin with the player page, which COEP requires; the
     * server moves remote plain-HTTP clients to HTTPS (server/isolation.go).
     */
    private openInLibmedia = () => {
        const query = `?src=${encodeURIComponent(this.source.path)}&name=${encodeURIComponent(this.source.title)}`;
        this.handOff(`/player.html${query}`);
    };

    /**
     * Chrome-for-Android intent URL pinned to VLC's package. Useful as a
     * second try if the vlc:// scheme isn't registered by the user's VLC
     * build. The form is:
     *
     *   intent://<host-and-path>#Intent;scheme=http;action=VIEW;
     *     type=video/*;package=org.videolan.vlc;end
     *
     * We deliberately omit `S.browser_fallback_url` so Chrome surfaces an
     * error if VLC isn't installed, instead of silently loading the URL
     * in the browser (which plays MKV with broken audio).
     */
    private openViaIntent = () => {
        const httpUrl = this.httpUrl || this.buildFileUrl();
        const stripped = httpUrl.replace(/^https?:\/\//, "");
        const intentUrl = `intent://${stripped}`
            + `#Intent;`
            + `scheme=http;`
            + `action=android.intent.action.VIEW;`
            + `type=video/*;`
            + `package=org.videolan.vlc;`
            + `end`;
        console.log("Opening via Android intent:", intentUrl);
        this.handOff(intentUrl);
    };

    private openInMpv = () => {
        const httpUrl = this.httpUrl || this.buildFileUrl();
        const mpvScheme = `mpv://${httpUrl}`;
        console.log("mpv hand-off:", mpvScheme);
        this.handOff(mpvScheme);
    };

    /**
     * mpv hand-off using a client-side path. Useful when the client has a
     * mapped SMB drive (e.g. Z:\) pointing at the same storage the server
     * exposes. We strip the configured server-side prefix from the file's
     * path and prepend the client-side prefix.
     */
    private openInMpvSmb = () => {
        const local = this.buildSmbPath();
        if (!local) {
            console.warn("openInMpvSmb: cannot translate path; check configured prefixes");
            this.showSmbConfig = true;
            return;
        }
        const mpvScheme = `mpv://${local}`;
        console.log("mpv SMB hand-off:", mpvScheme);
        this.handOff(mpvScheme);
    };

    private canUseSmb(): boolean {
        return !!this.clientPrefix && !!this.source?.serverPath;
    }

    private buildSmbPath(): string | null {
        if (!this.clientPrefix) return null;
        const raw = this.source?.serverPath || "";
        if (!raw) return null;

        let rest = raw;
        if (this.serverPrefix && raw.startsWith(this.serverPrefix)) {
            rest = raw.slice(this.serverPrefix.length);
        }

        // Detect whether the client prefix targets Windows (drive letter or
        // UNC) vs POSIX, and normalize separators accordingly.
        const isWindowsClient = /^[a-zA-Z]:[\\/]/.test(this.clientPrefix)
            || this.clientPrefix.startsWith("\\\\");
        const sep = isWindowsClient ? "\\" : "/";
        rest = rest.replace(/[\\/]+/g, sep).replace(new RegExp(`^\\${sep}+`), "");

        let prefix = this.clientPrefix;
        if (!prefix.endsWith("/") && !prefix.endsWith("\\")) prefix += sep;

        return prefix + rest;
    }

    private renderSmbConfig() {
        const preview = this.buildSmbPath();
        return html`
            <div class="smb-config">
                <label>
                    Server path prefix to strip
                    <input
                        type="text"
                        .value=${this.serverPrefix}
                        placeholder="/mnt/storage"
                        @input=${(e: Event) => { this.serverPrefix = (e.target as HTMLInputElement).value; }}
                    />
                </label>
                <label>
                    Client path prefix (mapped drive or UNC)
                    <input
                        type="text"
                        .value=${this.clientPrefix}
                        placeholder="Z:\\ or \\\\server\\storage\\"
                        @input=${(e: Event) => { this.clientPrefix = (e.target as HTMLInputElement).value; }}
                    />
                </label>
                <div class="preview">
                    Preview: ${preview
                        ? html`<code>${preview}</code>`
                        : html`<em>set a client prefix to preview</em>`}
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="copy" @click=${this.saveSmbConfig}>Save</button>
                    <button class="copy" @click=${this.clearSmbConfig}>Clear</button>
                </div>
            </div>
        `;
    }

    private saveSmbConfig = () => {
        localStorage.setItem(RemotePlayPicker.LS_SERVER_PREFIX, this.serverPrefix);
        localStorage.setItem(RemotePlayPicker.LS_CLIENT_PREFIX, this.clientPrefix);
        this.showSmbConfig = false;
    };

    private clearSmbConfig = () => {
        localStorage.removeItem(RemotePlayPicker.LS_SERVER_PREFIX);
        localStorage.removeItem(RemotePlayPicker.LS_CLIENT_PREFIX);
        this.serverPrefix = "";
        this.clientPrefix = "";
    };

    private openInVlc = () => {
        const httpUrl = this.httpUrl || this.buildFileUrl();
        const ua = navigator.userAgent || "";
        const isIOS = /iPad|iPhone|iPod/.test(ua)
            || (ua.includes("Mac") && "ontouchend" in document);

        // IMPORTANT: do NOT URL-encode the inner http URL. VLC for Android
        // expects the raw http URL appended to the scheme (confirmed by
        // testing - encoding triggers "multiple media cannot be played").
        const vlcScheme = `vlc://${httpUrl}`;
        const iosAlt = isIOS
            ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(httpUrl)}`
            : null;

        console.log("VLC hand-off. primary:", vlcScheme, "iosAlt:", iosAlt);
        this.handOff(vlcScheme);
        if (iosAlt) {
            setTimeout(() => { window.location.href = iosAlt!; }, 600);
        }
    };

    /**
     * Copy the raw URL to the clipboard. navigator.clipboard is only
     * available in a secure context (HTTPS or localhost), and this app
     * is usually accessed over plain HTTP on the LAN, so we fall back to
     * the deprecated-but-universal execCommand('copy') path.
     */
    private copyUrl = async () => {
        if (!this.httpUrl) return;
        const text = this.httpUrl;
        let ok = false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch (e) {
            console.warn("clipboard API failed, falling back:", e);
        }
        if (!ok) {
            ok = this.legacyCopy(text);
        }
        if (ok) {
            this.copied = true;
            setTimeout(() => { this.copied = false; }, 1500);
        } else {
            console.error("copy failed - browser blocked both paths");
        }
    };

    private legacyCopy(text: string): boolean {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.top = "0";
            ta.style.left = "0";
            ta.style.opacity = "0";
            // Attach to the light DOM so selection actually works across
            // shadow roots on some mobile browsers.
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            console.warn("legacyCopy failed:", e);
            return false;
        }
    }

    /** Goes to url and dismisses the sheet: the user has picked how to play. */
    private handOff(url: string) {
        window.location.href = url;
        this.close();
    }

    private close = () => {
        this.open = false;
        this.httpUrl = "";
        this.copied = false;
        this.dispatchEvent(new CustomEvent("close", {bubbles: true, composed: true}));
    };

    private buildFileUrl(): string {
        return `${window.location.origin}${this.source.path}`;
    }
}
