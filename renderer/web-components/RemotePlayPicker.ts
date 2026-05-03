import {html, LitElement, css} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {type MediaFile} from "../entity/MediaFile";

/**
 * Remote playback sheet. Shown when a non-local client (phone or another
 * desktop on the LAN) taps Play.
 *
 * Options offered:
 *   1. Open in VLC - `vlc://<httpUrl>` deep-link. Primary, works reliably
 *      on Android + iOS when VLC is installed.
 *   2. Open in browser - navigate to the raw /file/<id> URL and let the
 *      browser play it inline. Good for MP4/H.264+AAC sources.
 *   3. Copy URL fallback for VLC's "Open Network Stream" screen.
 *
 * The Web Share API path was removed because VLC's ACTION_SEND handler
 * mis-interprets the shared URL and plays a ~3-second placeholder instead
 * of streaming the file.
 *
 * Dispatches a "close" event when dismissed.
 */
@customElement("remote-play-picker")
export class RemotePlayPicker extends LitElement {

    @property({attribute: false}) public mediaFile!: MediaFile;
    @property({type: Boolean, reflect: true}) public open: boolean = false;

    @state() private httpUrl: string = "";
    @state() private copied: boolean = false;

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
        if (!this.open || !this.mediaFile) return html``;
        if (!this.httpUrl) this.httpUrl = this.buildFileUrl();

        return html`
            <div class="sheet" @click=${(e: Event) => e.stopPropagation()}>
                <h3>Play on this device</h3>
                <div class="sub">${this.mediaFile.raw || this.mediaFile.path || ""}</div>

                <button class="choice primary" @click=${this.openInVlc}>
                    <span>Open in VLC</span>
                    <span class="hint">Direct hand-off to VLC via the vlc:// link.</span>
                </button>

                <button class="choice" @click=${this.openViaIntent}>
                    <span>Open via Android Intent</span>
                    <span class="hint">Chrome-style intent:// URL pinned to VLC's Android package.</span>
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
     * Navigate the current tab to the raw /file/<id> URL. The browser's
     * built-in handler takes over: modern Chrome/Safari will render an
     * inline <video> element. Works great for MP4/H.264+AAC sources;
     * audio may be missing for MKV containers with AC3/DTS tracks.
     */
    private openInBrowser = () => {
        const httpUrl = this.httpUrl || this.buildFileUrl();
        console.log("Opening inline in browser:", httpUrl);
        window.location.href = httpUrl;
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
        window.location.href = intentUrl;
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
        window.location.href = vlcScheme;
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

    private close = () => {
        this.open = false;
        this.httpUrl = "";
        this.copied = false;
        this.dispatchEvent(new CustomEvent("close", {bubbles: true, composed: true}));
    };

    private buildFileUrl(): string {
        const origin = window.location.origin;
        const raw = this.mediaFile.path || this.mediaFile.raw || "";
        const base = raw.split(/[\\/]/).pop() || `media-${this.mediaFile.id}`;
        return `${origin}/file/${this.mediaFile.id}/${encodeURIComponent(base)}`;
    }
}
