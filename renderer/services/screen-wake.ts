/**
 * Keeps the screen on while playing. Browsers do that by themselves only
 * for a playing <video>, and libmedia draws to a canvas, so phones went to
 * sleep after a minute.
 *
 * Uses the Screen Wake Lock API. It needs a secure context (HTTPS) and is
 * missing in older browsers; there a tiny muted looping video (public/
 * keep-awake.mp4) plays instead, which browsers treat as watching video.
 */
export class ScreenWake {
    private wanted = false;
    private lock: WakeLockSentinel | null = null;
    private video: HTMLVideoElement | null = null;
    /** One request at a time, so a lock can't be granted twice and leak. */
    private acquiring: Promise<void> | null = null;

    public constructor() {
        document.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    public set(on: boolean) {
        this.wanted = on;
        if (on) {
            this.acquiring ??= this.acquire()
                .catch(e => console.warn("keeping the screen on failed:", e))
                .finally(() => { this.acquiring = null; });
        } else {
            this.release();
        }
    }

    public dispose() {
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.set(false);
        this.video?.remove();
        this.video = null;
    }

    private async acquire() {
        if (!("wakeLock" in navigator)) {
            await this.fallbackVideo().play();
            return;
        }
        if (this.lock && !this.lock.released) return;
        const lock = await navigator.wakeLock.request("screen");
        // Paused while the request was pending.
        if (!this.wanted) {
            await lock.release();
            return;
        }
        this.lock = lock;
    }

    private release() {
        this.lock?.release().catch(() => undefined);
        this.lock = null;
        this.video?.pause();
    }

    /** The browser drops the lock (and pauses the video) while the page is hidden. */
    private onVisibilityChange = () => {
        if (document.visibilityState === "visible" && this.wanted) this.set(true);
    };

    private fallbackVideo(): HTMLVideoElement {
        if (this.video) return this.video;
        const video = document.createElement("video");
        video.src = "/keep-awake.mp4";
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        // Must stay rendered: browsers don't keep the screen on for a video nobody can see.
        video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none";
        document.body.append(video);
        this.video = video;
        return video;
    }
}
