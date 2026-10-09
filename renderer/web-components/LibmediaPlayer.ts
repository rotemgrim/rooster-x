import {html, LitElement, css} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import {live} from "lit/directives/live.js";
import {openPlaybackSession, type PlaybackSession} from "../services/playback-session";
import {formatClock} from "../common/commonUtils";
import {ScreenWake} from "../services/screen-wake";

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
const HUD_HIDE_MS = 2_000;
/** A touch moving further than this is a swipe, not a tap. */
const SWIPE_START_PX = 12;
const BRIGHTNESS_MIN = 0.1;
const BRIGHTNESS_MAX = 1.5;

type Side = "left" | "right";

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
    /** CSS brightness() of the picture, set by swiping the left side. */
    @state() private brightness: number = 1;
    @state() private hudVisible: boolean = true;
    @state() private needsAudioUnlock: boolean = false;
    @state() private orientationLocked: boolean = false;
    @state() private session: PlaybackSession | null = null;

    @query("#screen") private screen!: HTMLDivElement;

    private readonly touchDevice = matchMedia("(pointer: coarse)").matches;
    private screenWake: ScreenWake | null = null;
    /**
     * Position to show instead of the player's while the user drags the seek
     * bar or a seek is in flight; null otherwise.
     */
    private heldPositionMs: number | null = null;
    private lastTap: {time: number; side: Side} | null = null;
    /**
     * Touch on the screen: becomes a swipe (volume on the right, brightness
     * on the left) once it moves, otherwise it's a tap.
     */
    private touch: {
        id: number; x: number; y: number; side: Side; from: number;
        gesture: "tap" | "swipe" | "none";
    } | null = null;
    private noticeTimer: number | undefined;
    private hudTimer: number | undefined;
    /** The HUD stays up while the mouse is over it or a select's picker is open. */
    private hoveringHud = false;
    private selectOpen = false;
    private lastMouse = {x: -1, y: -1};

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
        /* touch-action: none, swipes adjust volume / brightness instead of scrolling. */
        #screen { position: absolute; inset: 0; overflow: hidden; touch-action: none; }
        #screen > canvas, #screen > video {
            width: 100% !important; height: 100% !important; object-fit: var(--fit, contain);
            filter: brightness(var(--brightness, 1));
        }
        /* AVPlayer adds an ASS subtitle overlay (svg + .ASS-box) here; it must not eat clicks. */
        #screen * { pointer-events: none; }

        /*
         * libmedia's subtitle CSS writes these as .ASS-dialogue[data-border-style=…],
         * but the attribute sits on the text spans inside the dialogue, so
         * outlines, shadows and opaque boxes never showed. Same rules, fixed.
         */
        #screen [data-border-style="1"] { position: relative; }
        #screen [data-border-style="1"]::before, #screen [data-border-style="1"]::after {
            content: attr(data-text);
            position: absolute;
            top: 0; left: 0;
            z-index: -1;
            filter: blur(calc(var(--ass-scale-stroke) * var(--ass-tag-blur) * 1px));
        }
        #screen [data-border-style="1"]::before {
            color: var(--ass-shadow-color);
            -webkit-text-stroke: calc(var(--ass-scale-stroke) * var(--ass-border-width) * 1px) var(--ass-shadow-color);
            transform: translate(calc(var(--ass-scale-stroke) * var(--ass-tag-xshad) * 1px),
                                 calc(var(--ass-scale-stroke) * var(--ass-tag-yshad) * 1px));
        }
        #screen [data-border-style="1"]::after {
            color: var(--ass-border-color);
            -webkit-text-stroke: calc(var(--ass-scale-stroke) * var(--ass-border-width) * 1px) var(--ass-border-color);
        }
        /* Drawn by an SVG filter instead. */
        #screen [data-stroke="svg"]::before, #screen [data-stroke="svg"]::after { display: none; }
        #screen [data-border-style="3"] {
            position: relative;
            padding: calc(var(--ass-scale-stroke) * var(--ass-tag-ybord) * 1px)
                     calc(var(--ass-scale-stroke) * var(--ass-tag-xbord) * 1px);
        }
        #screen [data-border-style="3"]::before, #screen [data-border-style="3"]::after {
            content: "";
            position: absolute;
            width: 100%; height: 100%;
            z-index: -1;
        }
        #screen [data-border-style="3"]::before {
            background: var(--ass-shadow-color);
            left: calc(var(--ass-scale-stroke) * var(--ass-tag-xshad) * 1px);
            top: calc(var(--ass-scale-stroke) * var(--ass-tag-yshad) * 1px);
        }
        #screen [data-border-style="3"]::after { background: var(--ass-border-color); left: 0; top: 0; }

        /*
         * Plain-text subtitles (SRT, WebVTT, …) come in Arial with a hairline
         * outline: use the system UI font and a heavy outline plus shadow, so
         * they stay readable on white. ASS tracks keep their author's styling.
         * !important beats the font-family libmedia sets inline.
         */
        #screen.plain-subs [data-text] {
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial,
                         sans-serif !important;
            font-weight: 600;
            text-shadow: 0 0.05em 0.15em rgba(0, 0, 0, 0.9);
        }
        #screen.plain-subs [data-border-style="1"]::after { -webkit-text-stroke: 0.2em #000; }

        /* Controls scale with the screen, see uiScale(). */
        .top, .bar { zoom: var(--ui-scale, 1); transition: opacity 0.25s; }
        .hud-hidden { cursor: none; }
        .hud-hidden .top, .hud-hidden .bar { opacity: 0; pointer-events: none; }

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
            position: absolute;
            bottom: 0; left: 0; right: 0;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            padding: 1.2rem 1rem 0.6rem;
            background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
            flex-wrap: wrap;
            z-index: 1;
        }
        /*
         * Android Chrome shows a "swipe down to exit full screen" toast at the
         * bottom center when a page goes fullscreen (and again after rotating
         * or switching back), up to two lines, ~64dp tall. Pages can't hide
         * it: keep the bar above it. Zoomed by --ui-scale (1.25 on touch).
         */
        @media (pointer: coarse) {
            :host(:fullscreen) .bar { bottom: 64px; }
        }
        /* The installed app (manifest display: fullscreen) already fills the screen, without that toast. */
        @media (display-mode: fullscreen) {
            :host(:not(:fullscreen)) .fullscreen { display: none; }
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
        const message = this.status || this.notice;
        return html`
            <div id="surface" class=${this.hudVisible ? "" : "hud-hidden"} @pointermove=${this.onMouseMove}>
                <div id="screen" class=${this.session?.subtitlesStyled ? "" : "plain-subs"} style="--fit: ${this.fit}; --brightness: ${this.brightness}"
                     @pointerdown=${this.onScreenDown}
                     @pointermove=${this.onScreenMove}
                     @pointerup=${this.onScreenUp}
                     @pointercancel=${this.onScreenCancel}></div>
                <div class="top" @pointerenter=${this.onHudEnter} @pointerleave=${this.onHudLeave}
                     @pointerdown=${this.showHud}>
                    <span class="name">${this.name}</span>
                    ${this.renderMode()}
                    <button @click=${this.close}>✕ Close</button>
                </div>
                ${message ? html`<div class="status">${message}</div>` : null}
                ${this.needsAudioUnlock
                    ? html`<button class="big unlock" @click=${this.unlockAudio}>🔊 Tap to enable sound</button>`
                    : null}
                ${this.renderBar()}
            </div>
        `;
    }

    private renderBar() {
        const session = this.session;
        const durationMs = session?.durationMs ?? 0;
        return html`
            <div class="bar" @pointerenter=${this.onHudEnter} @pointerleave=${this.onHudLeave}
                 @pointerdown=${this.showHud} @input=${this.showHud}
                 @focusin=${this.onHudFocusIn} @focusout=${this.onHudFocusOut} @change=${this.onHudChange}>
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
                <button class="fullscreen" @click=${this.toggleFullscreen}>⛶</button>
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
                playing: () => {
                    this.playing = true;
                    this.screenWake?.set(true);
                    this.showHud();
                },
                paused: () => {
                    this.playing = false;
                    this.screenWake?.set(false);
                    this.showHud();
                },
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
        this.screenWake = new ScreenWake();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener("fullscreenchange", this.onFullscreenChange);
        window.removeEventListener("resize", this.applyUiScale);
        clearTimeout(this.hudTimer);
        // Locked without fullscreen (installed app): leaving fullscreen won't release it.
        if (this.orientationLocked) screen.orientation.unlock();
        this.screenWake?.dispose();
        this.screenWake = null;
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
     * Show the HUD, and hide it again after HUD_HIDE_MS without activity
     * while playing.
     */
    private showHud = () => {
        this.hudVisible = true;
        clearTimeout(this.hudTimer);
        this.hudTimer = window.setTimeout(() => {
            if (this.playing && !this.hoveringHud && !this.selectOpen) this.hudVisible = false;
        }, HUD_HIDE_MS);
    };

    /**
     * Browsers send a pointermove without movement when the layout under
     * the cursor changes (e.g. the HUD hiding), which must not wake it.
     */
    private onMouseMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse" || (e.screenX === this.lastMouse.x && e.screenY === this.lastMouse.y)) return;
        this.lastMouse = {x: e.screenX, y: e.screenY};
        this.showHud();
    };

    private onHudEnter = (e: PointerEvent) => {
        if (e.pointerType === "mouse") this.hoveringHud = true;
    };

    private onHudLeave = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        this.hoveringHud = false;
        this.showHud();
    };

    /**
     * On touch screens a focused select has its native picker open. With a
     * mouse, hovering keeps the HUD up instead: a select closed with Escape
     * stays focused.
     */
    private onHudFocusIn = (e: FocusEvent) => {
        if (this.touchDevice && e.target instanceof HTMLSelectElement) this.selectOpen = true;
    };

    private onHudFocusOut = () => {
        if (!this.selectOpen) return;
        this.selectOpen = false;
        this.showHud();
    };

    /** Drop focus once a pick is made, so the HUD can hide again. */
    private onHudChange = (e: Event) => {
        if (e.target instanceof HTMLSelectElement) e.target.blur();
    };

    private onScreenDown = (e: PointerEvent) => {
        if (e.pointerType !== "touch" || this.touch) return;
        const side = this.sideOf(e);
        this.touch = {
            id: e.pointerId, x: e.clientX, y: e.clientY, side,
            from: side === "right" ? this.volume : this.brightness,
            gesture: "tap",
        };
    };

    /** Swiping up / down: volume on the right side, brightness on the left. */
    private onScreenMove = (e: PointerEvent) => {
        const touch = this.touch;
        if (!touch || e.pointerId !== touch.id || touch.gesture === "none") return;
        const dx = e.clientX - touch.x;
        const dy = touch.y - e.clientY;
        if (touch.gesture === "tap") {
            if (Math.hypot(dx, dy) < SWIPE_START_PX) return;
            // Sideways: neither a tap nor a swipe.
            touch.gesture = Math.abs(dx) > Math.abs(dy) ? "none" : "swipe";
            if (touch.gesture === "none") return;
        }
        // A swipe across the full screen height covers the whole range.
        const value = touch.from + dy / this.screen.clientHeight;
        if (touch.side === "right") {
            this.volume = clamp(value, 0, 1);
            this.session?.setVolume(this.volume);
            this.notify(`🔊 ${Math.round(this.volume * 100)}%`, 800);
        } else {
            this.brightness = clamp(value, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
            this.notify(`☀ ${Math.round(this.brightness * 100)}%`, 800);
        }
    };

    private onScreenUp = (e: PointerEvent) => {
        const touch = this.touch;
        if (e.pointerType === "touch") {
            if (!touch || e.pointerId !== touch.id) return;
            this.touch = null;
            if (touch.gesture !== "tap") return;
        }
        this.onScreenTap(e);
    };

    private onScreenCancel = (e: PointerEvent) => {
        if (e.pointerId === this.touch?.id) this.touch = null;
    };

    private sideOf(e: PointerEvent): Side {
        const rect = this.screen.getBoundingClientRect();
        return e.clientX < rect.left + rect.width / 2 ? "left" : "right";
    }

    /**
     * A tap shows the HUD. Double tap on the left / right half skips back /
     * forward; every further quick tap on the same side skips again.
     */
    private onScreenTap(e: PointerEvent) {
        this.showHud();
        const side = this.sideOf(e);
        const last = this.lastTap;
        this.lastTap = {time: e.timeStamp, side};
        if (!last || last.side !== side || e.timeStamp - last.time > DOUBLE_TAP_MS) return;
        this.notify(side === "left" ? "⏪ −10s" : "⏩ +10s", 700);
        return this.seekTo((this.heldPositionMs ?? this.currentMs) + (side === "left" ? -SKIP_MS : SKIP_MS));
    }

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
     * while watching in bed / on the side. Browsers mostly allow the lock
     * only in fullscreen (and leaving fullscreen releases it), so that's the
     * fallback when locking as is fails; an installed full-screen app may be
     * allowed without it. iOS Safari doesn't support it at all.
     */
    private toggleOrientationLock = async () => {
        // lock() is missing from TypeScript's DOM types.
        const orientation = screen.orientation as ScreenOrientation & {lock(type: OrientationType): Promise<void>};
        if (this.orientationLocked) {
            orientation.unlock();
            this.orientationLocked = false;
            return;
        }
        const lock = () => orientation.lock(orientation.type);
        try {
            await lock().catch(async () => {
                await this.enterFullscreen();
                await lock();
            });
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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

declare global {
    interface HTMLElementTagNameMap {
        "libmedia-player": LibmediaPlayer;
    }
}
