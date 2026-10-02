import type AVPlayer from "@libmedia/avplayer";
import {enableExactSeek, seekKeepingSubtitleCues} from "./libmedia-workarounds";

/**
 * Typed adapter over libmedia's AVPlayer. Everything libmedia-specific lives
 * here: loading the runtime bundle, its event names, stream metadata, and
 * the fixes for its bugs (libmedia-workarounds.ts). UI code only sees
 * PlaybackSession, which only openPlaybackSession creates.
 *
 * The player bundle and its decoder .wasm files are served from /libmedia/
 * (see the libmedia-assets plugin in vite.config.ts; embedded in the Go
 * binary), so playback needs no internet access.
 */

export interface Track {
    id: number;
    label: string;
}

export interface PlaybackHandlers {
    time?: (ms: number) => void;
    playing?: () => void;
    paused?: () => void;
    /** The browser blocked audio until a user gesture; call resumeAudio(). */
    audioLocked?: () => void;
    audioUnlocked?: () => void;
    error?: (error: Error) => void;
}

/**
 * Loads src into a new player. The handlers are attached before anything
 * plays, so no event (e.g. the first "playing") can be missed. If loading
 * fails the player is torn down before the error propagates.
 *
 * src must answer HEAD requests (Go's /file/<id> handler does).
 */
export async function openPlaybackSession(container: HTMLDivElement, src: string,
                                          handlers: PlaybackHandlers): Promise<PlaybackSession> {
    // Absolute URLs: the decoders and the file are fetched from workers,
    // which can't resolve relative ones.
    const url = new URL(src, location.href).href;
    // libmedia retries a failed open for ~20s since it can't tell a missing
    // file from a network blip; fail fast on the former.
    const head = await fetch(url, {method: "HEAD"});
    if (!head.ok) throw new Error(`${head.status} ${head.statusText}`);

    const AVPlayerCtor = await loadAVPlayer();
    const player = new AVPlayerCtor({
        container,
        wasmBaseUrl: new URL("/libmedia/wasm", location.origin).href,
    });
    attachHandlers(player, handlers);
    try {
        await player.load(url);
    } catch (e) {
        await player.destroy().catch(() => undefined);
        throw e;
    }
    return new PlaybackSession(player, enableExactSeek(AVPlayerCtor, player));
}

export type {PlaybackSession};

function attachHandlers(player: AVPlayer, handlers: PlaybackHandlers) {
    const on = (event: string, handler?: (...args: never[]) => void) => {
        if (handler) player.on(event, handler);
    };
    const {time} = handlers;
    on("time", time && ((pts: bigint) => time(Number(pts))));
    on("played", handlers.playing);
    on("paused", handlers.paused);
    on("ended", handlers.paused);
    on("resume", handlers.audioLocked);
    on("audioContextRunning", handlers.audioUnlocked);
    on("error", handlers.error);
}

class PlaybackSession {
    public readonly durationMs: number;
    public readonly audioTracks: Track[];
    public readonly subtitleTracks: Track[];

    private queue: Promise<unknown> = Promise.resolve();
    private subtitlesOn = true;

    public constructor(private readonly player: AVPlayer, private readonly disableExactSeek: () => void) {
        this.durationMs = Number(player.getDuration());
        this.audioTracks = listTracks(player, "audio");
        this.subtitleTracks = listTracks(player, "subtitle");
    }

    public get selectedAudio(): number {
        return this.player.getSelectedAudioStreamId();
    }

    /** null when subtitles are off. */
    public get selectedSubtitle(): number | null {
        const id = this.player.getSelectedSubtitleStreamId();
        return this.subtitlesOn && id >= 0 ? id : null;
    }

    public get audioLocked(): boolean {
        return this.player.isSuspended();
    }

    public play = () => this.serial(() => this.player.play());
    public pause = () => this.serial(() => this.player.pause());
    public seek = (ms: number) => this.serial(() => this.seekTo(BigInt(ms)));
    public selectAudio = (id: number) => this.serial(() => this.player.selectAudio(id));

    /** null turns subtitles off. */
    public selectSubtitle = (id: number | null) => this.serial(async () => {
        const player = this.player;
        if (id === null) {
            player.setSubtitleEnable(false);
            this.subtitlesOn = false;
            return;
        }
        if (id !== player.getSelectedSubtitleStreamId()) await player.selectSubtitle(id);
        player.setSubtitleEnable(true);
        this.subtitlesOn = true;
        // The demuxer reads ~4s ahead, so the new track's upcoming cues were
        // already dropped. Re-seek in place (exact, see enableExactSeek) to
        // show them right away.
        await this.seekTo(player.currentTime);
    });

    public setVolume(volume: number) {
        this.player.setVolume(volume);
    }

    public resumeAudio(): Promise<void> {
        return this.player.resume();
    }

    public async destroy() {
        this.disableExactSeek();
        await this.player.destroy();
    }

    private async seekTo(timestamp: bigint) {
        await (this.subtitlesOn
            ? seekKeepingSubtitleCues(this.player, timestamp)
            : this.player.seek(timestamp));
        // AVPlayer's seek restarts the subtitle renderer; keep "off" off.
        if (!this.subtitlesOn) this.player.setSubtitleEnable(false);
    }

    /**
     * AVPlayer saves and restores its status around play/pause, seeks and
     * track changes; when two overlap it restores the wrong one and stays
     * stuck "changing". Run them one at a time.
     */
    private serial(op: () => Promise<void>): Promise<void> {
        const result = this.queue.then(op, op);
        this.queue = result.catch(() => undefined);
        return result;
    }
}

let avPlayerModule: Promise<typeof AVPlayer> | undefined;

function loadAVPlayer(): Promise<typeof AVPlayer> {
    // A variable, not a literal: the runtime bundle must not be resolved or
    // bundled by Vite/Rollup.
    const url = "/libmedia/avplayer.js";
    avPlayerModule ??= import(/* @vite-ignore */ url).then(mod => mod.default);
    return avPlayerModule;
}

/**
 * Numbered so tracks with the same title and language (common in anime
 * releases: several "Stereo · eng" tracks) stay distinguishable.
 */
function listTracks(player: AVPlayer, mediaType: "audio" | "subtitle"): Track[] {
    return player.getStreams()
        .filter(s => s.mediaType.toLowerCase() === mediaType)
        .map((s, i) => {
            const lang = s.metadata?.language || s.metadata?.LANGUAGE;
            const title = s.metadata?.title || s.metadata?.TITLE;
            const label = [title, lang].filter(Boolean).join(" · ");
            return {id: s.id, label: label ? `${i + 1}. ${label}` : `Track ${i + 1}`};
        });
}
