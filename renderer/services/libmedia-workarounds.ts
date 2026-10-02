import type AVPlayer from "@libmedia/avplayer";

/**
 * Workarounds for @libmedia/avplayer bugs that patch its private internals.
 * Verified against 1.3.1 (pinned exactly in package.json): re-check both
 * when upgrading. Kept apart from playback-session.ts, which only uses the
 * public API, so this file is the one place an upgrade can break.
 */

/** The slice of AVPlayer's undocumented, shared demuxer thread we wrap. */
interface DemuxerThread {
    seek(taskId: string, timestamp: bigint, ...rest: unknown[]): Promise<bigint>;
}

/** The slice of AVPlayer's private subtitle renderer we drive. */
interface SubtitleRender {
    pause(): void;
    reset(): void;
}

const exactSeekTasks = new Set<string>();
let patchedDemuxer: DemuxerThread | undefined;

/**
 * libmedia's MKV demuxer seeks to the keyframe *nearest* the target. When
 * that keyframe is before the target, AVPlayer decodes from it and drops
 * frames up to the exact time; when it's after, playback resumes late (up to
 * half a GOP, several seconds on typical encodes).
 *
 * Wraps the demuxer's seek so a landing past the target is retried earlier
 * until it lands at or before it; AVPlayer then syncs to the exact target.
 * The demuxer thread is shared by all players and recreated after the last
 * one is destroyed, so the wrapper is (re)installed whenever it changed, and
 * applies to registered players only. Returns the unregister function.
 */
export function enableExactSeek(AVPlayerCtor: typeof AVPlayer, player: AVPlayer): () => void {
    const statics = AVPlayerCtor as unknown as {DemuxerThread: DemuxerThread};
    const demuxer = statics.DemuxerThread;
    if (demuxer !== patchedDemuxer) {
        const seek = async (taskId: string, timestamp: bigint, ...rest: unknown[]): Promise<bigint> => {
            let landed = await demuxer.seek(taskId, timestamp, ...rest);
            if (!exactSeekTasks.has(taskId)) return landed;
            let step = (landed - timestamp) * 2n + 1000n;
            for (let i = 0; i < 5 && landed > timestamp && timestamp > 0n; i++, step *= 2n) {
                landed = await demuxer.seek(taskId, timestamp > step ? timestamp - step : 0n, ...rest);
            }
            return landed;
        };
        patchedDemuxer = new Proxy(demuxer, {
            // Other members unbound on purpose: the thread's RPC methods carry
            // extra properties (e.g. .transfer) that bind() would drop.
            get: (target, key) => (key === "seek" ? seek : Reflect.get(target, key)),
        });
        statics.DemuxerThread = patchedDemuxer;
    }
    exactSeekTasks.add(player.taskId);
    return () => exactSeekTasks.delete(player.taskId);
}

/**
 * Seeks without losing subtitle cues. AVPlayer's subtitle renderer keeps
 * pulling cues while a seek decodes up to the target, and AVPlayer clears
 * its queue when the seek ends, dropping the cues that start right after
 * the target. So clear the stale cues (and the one on screen) when the seek
 * starts instead, and skip AVPlayer's clear at the end.
 *
 * Callers must not run another player operation concurrently (the session
 * serializes them), since reset() is swapped out for the seek's duration.
 */
export async function seekKeepingSubtitleCues(player: AVPlayer, timestamp: bigint): Promise<void> {
    const render = (player as unknown as {subtitleRender: SubtitleRender | null}).subtitleRender;
    if (!render) return player.seek(timestamp);
    render.pause();
    render.reset();
    const reset = render.reset;
    render.reset = () => undefined;
    try {
        await player.seek(timestamp);
    } finally {
        // Leaves an own property holding the original prototype method,
        // which behaves the same.
        render.reset = reset;
    }
}
