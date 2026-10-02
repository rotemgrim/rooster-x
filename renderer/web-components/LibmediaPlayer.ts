import {html, LitElement, css} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import {live} from "lit/directives/live.js";
import {openPlaybackSession, type PlaybackSession} from "../services/playback-session";
import {formatClock} from "../common/commonUtils";

const SUBTITLES_OFF = "off";

/** How the picture fits the screen: CSS object-fit values on the canvas. */
const FIT_MODES = [
    {id: "contain", label: "Fit"},
    {id: "cover", label: "Fill (crop)"},
    {id: "fill", label: "Stretch"},
    {id: "none", label: "Original size"},
] as const;
type FitMode = typeof FIT_MODES[number]["id"];
const FIT_STORAGE_KEY = "rooster.player.fit";

const SKIP_MS = 10_000;
const DOUBLE_TAP_MS = 350;

/**
 * Full-screen player UI for a /file/<id> URL, backed by libmedia (see
 * services/playback-session.ts). Unlike the browser's native <video>, it
 * decodes AC3 / E-AC3 / DTS audio inside MKV, so remote clients get sound.
 *
 * Dispatches a "close" event when dismissed.
 */
@customElement("libmedia-player")
export class LibmediaPlayer extends LitElement {

    @property() public src: string = "";
    @property() public name: string = "";

    /** Loading progress or a fatal error; empty while playing. */
    @state() private status: string = "Loading player…";
    /** Short-lived message, see notify(). */
    @state() private notice: string = "";
    @state() private playing: boolean = false;
    @state() private currentMs: number = 0;
    @state() private fit: FitMode = loadFitMode();
    @state() private volume: number = 1;
    @state() private needsAudioUnlock: boolean = false;
    @state() private orientationLocked: boolean = false;
    @state() private session: PlaybackSession | null = null;

    @query("#screen") private screen!: HTMLDivElement;

    private readonly touchDevice = matchMedia("(pointer: coarse)").matches;
    /**
     * Position to show instead of the player's while the user drags the seek
     * bar or a seek is in flight; null otherwise.
     */
    private heldPositionMs: number | null = null;
    private lastTap: {time: number; side: "left" | "right"} | null = null;
    private noticeTimer: number | undefined;

    static styles = css`
        :host {
            position: fixed;
            inset: 0;
            z-index: 10000;
            background: #000;
            display: flex;
            flex-direction: column;
            color: #e8eaed;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }
        #surface { flex: 1; min-height: 0; position: relative; }
        #screen { position: absolute; inset: 0; overflow: hidden; touch-action: manipulation; }
        #screen > canvas, #screen > video {
            width: 100% !important; height: 100% !important; object-fit: var(--fit, contain);
        }
        /* AVPlayer adds an ASS subtitle overlay (svg + .ASS-box) here; it must not eat clicks. */
        #screen * { pointer-events: none; }

        /* Controls scale with the screen, see uiScale(). */
        .top, .bar { zoom: var(--ui-scale, 1); }

        .top {
            position: absolute;
            top: 0; left: 0; right: 0;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.75rem 1rem;
            background: linear-gradient(rgba(0, 0, 0, 0.7), transparent);
            z-index: 1;
        }
        .top .name { flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .top .mode { font-size: 0.75rem; color: #a8aeb8; white-space: nowrap; }
        .top a.mode { color: #ff3344; }

        .status {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            color: #a8aeb8;
        }

        .unlock {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2;
        }

        .bar {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 0.6rem 1rem;
            background: #0f1216;
            flex-wrap: wrap;
        }
        .bar .time { font-variant-numeric: tabular-nums; font-size: 0.85rem; white-space: nowrap; }
        .bar input.seek { flex: 1; min-width: 120px; accent-color: #ff3344; }
        .bar input.vol { width: 80px; accent-color: #ff3344; }

        button, select {
            appearance: none;
            background: #262b34;
            color: #e8eaed;
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0.4rem 0.7rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
        }
        button:hover { border-color: #ff3344; }
        button.big { padding: 0.8rem 1.2rem; font-size: 1rem; background: #ff3344; border-color: #ff3344; }
    `;

    public render() {
        const session = this.session;
        const durationMs = session?.durationMs ?? 0;
        const message = this.status || this.notice;
        return html`
            <div id="surface">
                <div id="screen" style="--fit: ${this.fit}" @pointerup=${this.onScreenTap}></div>
                <div class="top">
                    <span class="name">${this.name}</span>
                    ${this.renderMode()}
                    <button @click=${this.close}>✕ Close</button>
                </div>
                ${message ? html`<div class="status">${message}</div>` : null}
                ${this.needsAudioUnlock
                    ? html`<button class="big unlock" @click=${this.unlockAudio}>🔊 Tap to enable sound</button>`
                    : null}
            </div>
            <div class="bar">
                <button @click=${this.togglePlay}>${this.playing ? "❚❚" : "▶"}</button>
                <span class="time">${formatClock(this.currentMs / 1000)} / ${formatClock(durationMs / 1000)}</span>
                <input class="seek" type="range" min="0" step="1000"
                       .max=${String(durationMs)}
                       .value=${String(this.currentMs)}
                       @input=${this.onSeekInput}
                       @change=${this.onSeekCommit}/>
                ${this.touchDevice
                    ? null
                    : html`<input class="vol" type="range" min="0" max="1" step="0.05"
                                  .value=${String(this.volume)}
                                  @input=${this.onVolume}/>`}
                ${session && session.audioTracks.length > 1
                    ? renderSelect("Audio track", "🔊", session.audioTracks,
                        String(session.selectedAudio), this.onAudioTrack)
                    : null}
                ${session?.subtitleTracks.length
                    ? renderSelect("Subtitles", "💬", [{id: SUBTITLES_OFF, label: "Off"}, ...session.subtitleTracks],
                        String(session.selectedSubtitle ?? SUBTITLES_OFF), this.onSubtitleTrack)
                    : null}
                ${renderSelect("Picture size", "⤢", FIT_MODES, this.fit, this.onFit)}
                ${this.touchDevice
                    ? html`<button title=${this.orientationLocked ? "Unlock rotation" : "Lock rotation"}
                                   @click=${this.toggleOrientationLock}>${this.orientationLocked ? "🔒" : "🔓"}</button>`
                    : null}
                <button @click=${this.toggleFullscreen}>⛶</button>
            </div>
        `;
    }

    /**
     * Multithreaded decoding needs a cross-origin isolated page, which
     * browsers only grant over trusted HTTPS. On HTTPS without isolation the
     * self-signed cert isn't trusted yet, so link to it for installing.
     */
    private renderMode() {
        if (self.crossOriginIsolated) return html`<span class="mode">multi-thread</span>`;
        if (location.protocol !== "https:") return html`<span class="mode">single-thread</span>`;
        return html`<a class="mode" href="/roosterx.crt"
                       title="Install and trust this certificate on the device to enable multithreaded decoding">
            single-thread · install certificate</a>`;
    }

    protected async firstUpdated() {
        try {
            this.status = "Opening file…";
            const session = await openPlaybackSession(this.screen, this.src, {
                time: ms => {
                    if (this.heldPositionMs === null) this.currentMs = ms;
                },
                playing: () => { this.playing = true; },
                paused: () => { this.playing = false; },
                audioLocked: () => { this.needsAudioUnlock = true; },
                audioUnlocked: () => { this.needsAudioUnlock = false; },
                error: err => {
                    console.error("libmedia error:", err);
                    this.status = `Error: ${err.message}`;
                },
            });
            // Closed while loading: disconnectedCallback had nothing to destroy.
            if (!this.isConnected) {
                await session.destroy();
                return;
            }
            this.session = session;
            await session.play();
            // Re-renders the selects too: AVPlayer picks the default tracks
            // while starting playback.
            this.status = "";
        } catch (e) {
            console.error("libmedia player failed:", e);
            this.status = `Playback failed: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    public connectedCallback() {
        super.connectedCallback();
        document.addEventListener("fullscreenchange", this.onFullscreenChange);
        window.addEventListener("resize", this.applyUiScale);
        this.applyUiScale();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("fullscreenchange", this.onFullscreenChange);
        window.removeEventListener("resize", this.applyUiScale);
        this.session?.destroy().catch(e => console.warn("libmedia destroy failed:", e));
        this.session = null;
    }

    /**
     * Run a session operation, then re-render from the session's actual
     * state, so on failure the selects snap back to what's really playing.
     */
    private act(op: Promise<void>): Promise<void> {
        return op
            .catch(e => console.warn("libmedia operation failed:", e))
            .finally(() => this.requestUpdate());
    }

    private togglePlay = () => {
        if (!this.session) return;
        return this.act(this.playing ? this.session.pause() : this.session.play());
    };

    private unlockAudio = async () => {
        if (!this.session) return;
        await this.session.resumeAudio();
        this.needsAudioUnlock = this.session.audioLocked;
    };

    private onSeekInput = (e: Event) => {
        this.heldPositionMs = this.currentMs = Number((e.target as HTMLInputElement).value);
    };

    private onSeekCommit = (e: Event) => this.seekTo(Number((e.target as HTMLInputElement).value));

    private seekTo(ms: number) {
        if (!this.session) return;
        const target = Math.max(0, Math.min(ms, this.session.durationMs));
        this.heldPositionMs = this.currentMs = target;
        return this.act(this.session.seek(target)).finally(() => {
            // A later seek may already be holding its own target.
            if (this.heldPositionMs === target) this.heldPositionMs = null;
        });
    }

    /**
     * Double tap on the left / right half skips back / forward; every
     * further quick tap on the same side skips again.
     */
    private onScreenTap = (e: PointerEvent) => {
        const rect = this.screen.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? "left" : "right";
        const last = this.lastTap;
        this.lastTap = {time: e.timeStamp, side};
        if (!last || last.side !== side || e.timeStamp - last.time > DOUBLE_TAP_MS) return;
        this.notify(side === "left" ? "⏪ −10s" : "⏩ +10s", 700);
        return this.seekTo((this.heldPositionMs ?? this.currentMs) + (side === "left" ? -SKIP_MS : SKIP_MS));
    };

    private onFit = (e: Event) => {
        this.fit = (e.target as HTMLSelectElement).value as FitMode;
        try {
            localStorage.setItem(FIT_STORAGE_KEY, this.fit);
        } catch {
            // Storage unavailable (private mode): the choice just isn't remembered.
        }
    };

    private applyUiScale = () => {
        this.style.setProperty("--ui-scale", String(uiScale(this.touchDevice)));
    };

    private onVolume = (e: Event) => {
        this.volume = Number((e.target as HTMLInputElement).value);
        this.session?.setVolume(this.volume);
    };

    private onAudioTrack = (e: Event) => {
        if (!this.session) return;
        return this.act(this.session.selectAudio(Number((e.target as HTMLSelectElement).value)));
    };

    private onSubtitleTrack = (e: Event) => {
        if (!this.session) return;
        const value = (e.target as HTMLSelectElement).value;
        return this.act(this.session.selectSubtitle(value === SUBTITLES_OFF ? null : Number(value)));
    };

    private async enterFullscreen() {
        if (!document.fullscreenElement) await this.requestFullscreen();
    }

    private exitFullscreen() {
        if (!document.fullscreenElement) return;
        document.exitFullscreen().catch(e => console.warn("exit fullscreen failed:", e));
    }

    private toggleFullscreen = () => {
        if (document.fullscreenElement) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen().catch(e => console.warn("fullscreen failed:", e));
        }
    };

    /**
     * Lock the screen to its current orientation so the phone doesn't flip
     * while watching in bed / on the side. Browsers only allow the lock in
     * fullscreen (and leaving fullscreen releases it); iOS Safari doesn't
     * support it at all.
     */
    private toggleOrientationLock = async () => {
        // lock() is missing from TypeScript's DOM types.
        const orientation = screen.orientation as ScreenOrientation & {lock(type: OrientationType): Promise<void>};
        if (this.orientationLocked) {
            orientation.unlock();
            this.orientationLocked = false;
            return;
        }
        try {
            await this.enterFullscreen();
            await orientation.lock(orientation.type);
            this.orientationLocked = true;
        } catch (e) {
            console.warn("orientation lock failed:", e);
            this.notify("Rotation lock isn't supported in this browser");
        }
    };

    private onFullscreenChange = () => {
        if (!document.fullscreenElement) this.orientationLocked = false;
    };

    private notify(message: string, durationMs = 3000) {
        this.notice = message;
        clearTimeout(this.noticeTimer);
        this.noticeTimer = window.setTimeout(() => { this.notice = ""; }, durationMs);
    }

    private close = () => {
        this.exitFullscreen();
        this.dispatchEvent(new CustomEvent("close", {bubbles: true, composed: true}));
    };
}

/**
 * live(): the user's pick changes the DOM directly, so when an operation
 * fails and the state stays the same, the selection must still be reset.
 */
function renderSelect(title: string, icon: string, options: readonly {id: number | string; label: string}[],
                      selected: string, onChange: (e: Event) => void) {
    return html`<select title=${title} @change=${onChange}>
        ${options.map(t => html`
            <option value=${t.id} .selected=${live(String(t.id) === selected)}>${icon} ${t.label}</option>`)}
    </select>`;
}

function loadFitMode(): FitMode {
    try {
        const saved = localStorage.getItem(FIT_STORAGE_KEY);
        return FIT_MODES.find(m => m.id === saved)?.id ?? "contain";
    } catch {
        return "contain";
    }
}

/**
 * Size factor for the controls. Phones in "desktop site" mode lay the page
 * out ~980px wide and shrink it to fit, which made the controls tiny: the
 * ratio of the viewport's short side to the screen's undoes that. Touch
 * screens also get larger tap targets.
 */
function uiScale(touchDevice: boolean): number {
    const desktopSiteShrink = Math.min(innerWidth, innerHeight) / Math.min(screen.width, screen.height);
    return Math.max(1, desktopSiteShrink) * (touchDevice ? 1.25 : 1);
}
