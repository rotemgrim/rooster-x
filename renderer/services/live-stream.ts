import Hls, {type HlsConfig} from "hls.js";

// hls.js retries only timeouts and 5xx; a 4xx or a dropped connection on a
// segment or playlist is fatal. More patient retries keep a slow provider
// from getting there, and LiveStream restarts the stream when it does.
const LOAD_RETRY = {maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000};
const HLS_CONFIG: Partial<HlsConfig> = {
    // start a little further behind the live edge, leaving more room to buffer
    liveSyncDurationCount: 4,
    fragLoadPolicy: {default: {maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 60000, timeoutRetry: LOAD_RETRY, errorRetry: LOAD_RETRY}},
    playlistLoadPolicy: {default: {maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 20000, timeoutRetry: LOAD_RETRY, errorRetry: LOAD_RETRY}},
};
/** Restarts in a row without a segment playing before giving up. */
const MAX_RESTARTS = 8;

/**
 * Plays a live HLS stream in a <video> and keeps it going. A fatal error
 * reloads it from the playlist, backing off between tries; the server's
 * proxy fetches a fresh provider redirect then, so expired segment links
 * come back working.
 */
export class LiveStream {
    private hls: Hls | null = null;
    private restartTimer: number | undefined;
    private restarts = 0;

    public constructor(private readonly video: HTMLVideoElement, private readonly url: string) {
        this.start();
    }

    public dispose() {
        clearTimeout(this.restartTimer);
        this.hls?.destroy();
        this.hls = null;
    }

    private start() {
        const hls = this.hls = new Hls(HLS_CONFIG);
        let mediaRecovered = false;
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            this.video.play().catch(() => {});
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
            this.restarts = 0;
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
                mediaRecovered = true;
                hls.recoverMediaError();
                return;
            }
            if (this.restarts >= MAX_RESTARTS) {
                console.error(`Giving up on ${this.url} after ${this.restarts} restarts:`, data.details);
                return;
            }
            const delay = Math.min(1000 * 2 ** this.restarts, 10000);
            this.restarts++;
            console.warn(`Stream failed (${data.details}), restarting in ${delay}ms`);
            this.dispose();
            this.restartTimer = window.setTimeout(() => this.start(), delay);
        });
        hls.loadSource(this.url);
        hls.attachMedia(this.video);
    }
}
