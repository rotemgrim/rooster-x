import {html, LitElement, css} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import type AVPlayer from "@libmedia/avplayer";

interface AudioTrack {
    id: number;
    label: string;
}

/**
 * Full-screen overlay that plays a /file/<id> URL with libmedia's AVPlayer
 * (WebAssembly demux + decode). Unlike the browser's native <video>, it can
 * decode AC3 / E-AC3 / DTS audio inside MKV, so remote clients get sound.
 *
 * The player bundle and its decoder .wasm files are served from /libmedia/
 * (copied there by the Vite plugin in vite.config.ts and embedded in the Go
 * binary), so playback needs no internet access.
 *
 * Dispatches a "close" event when dismissed.
 */
@customElement("libmedia-player")
export class LibmediaPlayer extends LitElement {

    @property() public src: string = "";
    @property() public name: string = "";

    @state() private status: string = "Loading player…";
    @state() private playing: boolean = false;
    @state() private currentMs: number = 0;
    @state() private durationMs: number = 0;
    @state() private volume: number = 1;
    @state() private needsAudioUnlock: boolean = false;
    @state() private audioTracks: AudioTrack[] = [];
    @state() private selectedAudio: number = -1;

    @query("#screen") private screen!: HTMLDivElement;

    private player: AVPlayer | null = null;
    private seeking: boolean = false;

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
        #screen { position: absolute; inset: 0; }
        #screen > * { width: 100% !important; height: 100% !important; object-fit: contain; }

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
        return html`
            <div id="surface">
                <div id="screen"></div>
                <div class="top">
                    <span class="name">${this.name}</span>
                    ${this.renderMode()}
                    <button @click=${this.close}>✕ Close</button>
                </div>
                ${this.status ? html`<div class="status">${this.status}</div>` : null}
                ${this.needsAudioUnlock
                    ? html`<button class="big unlock" @click=${this.unlockAudio}>🔊 Tap to enable sound</button>`
                    : null}
            </div>
            <div class="bar">
                <button @click=${this.togglePlay}>${this.playing ? "❚❚" : "▶"}</button>
                <span class="time">${fmt(this.currentMs)} / ${fmt(this.durationMs)}</span>
                <input class="seek" type="range" min="0" step="1000"
                       .max=${String(this.durationMs || 0)}
                       .value=${String(this.currentMs)}
                       @input=${this.onSeekInput}
                       @change=${this.onSeekCommit}/>
                <input class="vol" type="range" min="0" max="1" step="0.05"
                       .value=${String(this.volume)}
                       @input=${this.onVolume}/>
                ${this.audioTracks.length > 1
                    ? html`<select @change=${this.onAudioTrack}>
                          ${this.audioTracks.map(t => html`
                              <option value=${t.id} ?selected=${t.id === this.selectedAudio}>${t.label}</option>`)}
                      </select>`
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
            // Runtime import from the copied dist; must not be bundled by Vite.
            // A full URL (not "/libmedia/...") keeps the Vite dev server from
            // rewriting it to "?import", which it refuses for public/ files.
            const url = new URL("/libmedia/avplayer.js", location.origin).href;
            const mod = await import(/* @vite-ignore */ url);
            const AVPlayerCtor = mod.default as typeof AVPlayer;

            const player = new AVPlayerCtor({
                container: this.screen,
                // Absolute: decoders are fetched from workers.
                wasmBaseUrl: new URL("/libmedia/wasm", location.origin).href,
            });
            this.player = player;
            this.bindEvents(player);

            this.status = "Opening file…";
            // Decoding runs in workers, which can't resolve relative URLs.
            await player.load(new URL(this.src, location.href).href);
            this.durationMs = Number(player.getDuration());
            this.loadAudioTracks(player);

            await player.play();
            this.status = "";
        } catch (e) {
            console.error("libmedia player failed:", e);
            this.status = `Playback failed: ${(e as Error)?.message || e}`;
        }
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        this.player?.destroy().catch(e => console.warn("libmedia destroy failed:", e));
        this.player = null;
    }

    private bindEvents(player: AVPlayer) {
        player.on("time", (pts: bigint) => {
            if (!this.seeking) this.currentMs = Number(pts);
        });
        player.on("played", () => { this.playing = true; });
        player.on("paused", () => { this.playing = false; });
        player.on("ended", () => { this.playing = false; });
        player.on("resume", () => { this.needsAudioUnlock = true; });
        player.on("audioContextRunning", () => { this.needsAudioUnlock = false; });
        player.on("error", (err: Error) => {
            console.error("libmedia error:", err);
            this.status = `Error: ${err?.message || err}`;
        });
    }

    private loadAudioTracks(player: AVPlayer) {
        const streams = player.getStreams().filter(s => s.mediaType.toLowerCase() === "audio");
        this.audioTracks = streams.map((s, i) => {
            const lang = s.metadata?.language || s.metadata?.LANGUAGE;
            const title = s.metadata?.title || s.metadata?.TITLE;
            const label = [title, lang].filter(Boolean).join(" · ") || `Track ${i + 1}`;
            return {id: s.id, label};
        });
        this.selectedAudio = player.getSelectedAudioStreamId();
    }

    private togglePlay = async () => {
        if (!this.player) return;
        if (this.playing) {
            await this.player.pause();
        } else {
            await this.player.play();
        }
    };

    private unlockAudio = async () => {
        await this.player?.resume();
        this.needsAudioUnlock = this.player?.isSuspended() ?? false;
    };

    private onSeekInput = (e: Event) => {
        this.seeking = true;
        this.currentMs = Number((e.target as HTMLInputElement).value);
    };

    private onSeekCommit = async (e: Event) => {
        const ms = Number((e.target as HTMLInputElement).value);
        try {
            await this.player?.seek(BigInt(ms));
        } finally {
            this.seeking = false;
        }
    };

    private onVolume = (e: Event) => {
        this.volume = Number((e.target as HTMLInputElement).value);
        this.player?.setVolume(this.volume);
    };

    private onAudioTrack = async (e: Event) => {
        const id = Number((e.target as HTMLSelectElement).value);
        await this.player?.selectAudio(id);
        this.selectedAudio = id;
    };

    private toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.requestFullscreen?.();
        }
    };

    private close = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        this.dispatchEvent(new CustomEvent("close", {bubbles: true, composed: true}));
    };
}

function fmt(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0");
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
