import {defineConfig, type Plugin} from "vite";
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";

const AVPLAYER_DIR = resolve(__dirname, "node_modules/@libmedia/avplayer");
const LIBMEDIA_VERSION: string = JSON.parse(readFileSync(resolve(AVPLAYER_DIR, "package.json"), "utf-8")).version;

// The decoders AVPlayer loads at runtime. It picks the "-simd" build on any
// browser with WebAssembly SIMD (Chrome 91+, Firefox 89+, Safari 16.4+), so
// only those are shipped. They aren't on npm; they live in the GitHub repo.
const WASM_CODECS = [
    "aac", "ac3", "adpcm", "av1", "bmp", "dca", "dvaudio", "dvvideo", "eac3", "flac", "gif", "h261", "h263",
    "h264", "hevc", "mjpeg", "mp3", "mpeg2video", "mpeg4", "msmpeg4", "opus", "pcm", "png", "ra", "rv",
    "speex", "theora", "tiff", "vorbis", "vp8", "vp9", "vvc", "webp", "wma", "wmv",
];
const WASM_FILES = [
    ...WASM_CODECS.map(c => `decode/${c}-simd.wasm`),
    "resample/resample-simd.wasm",
    "stretchpitch/stretchpitch-simd.wasm",
];

/**
 * libmedia's AVPlayer is a webpack build that lazy-loads its own chunks
 * (NN.avplayer.js) relative to the entry file, so it can't be bundled by
 * Vite. Copy its ESM dist into public/libmedia and import it at runtime
 * from /libmedia/avplayer.js instead.
 *
 * The decoder .wasm files go to public/libmedia/wasm so the Go binary embeds
 * them and playback works without internet. They are downloaded once into
 * node_modules/.cache and reused by later builds.
 */
function libmediaAssets(): Plugin {
    const dest = resolve(__dirname, "public/libmedia");
    const cache = resolve(__dirname, `node_modules/.cache/libmedia-wasm/${LIBMEDIA_VERSION}`);
    const baseUrl = `https://cdn.jsdelivr.net/gh/zhaohappy/libmedia@${LIBMEDIA_VERSION}/dist`;

    return {
        name: "libmedia-assets",
        async buildStart() {
            if (existsSync(dest)) rmSync(dest, {recursive: true});
            cpSync(resolve(AVPLAYER_DIR, "dist/esm"), dest, {recursive: true});

            await Promise.all(WASM_FILES.map(async file => {
                const cached = resolve(cache, file);
                if (!existsSync(cached)) {
                    const res = await fetch(`${baseUrl}/${file}`);
                    if (!res.ok) throw new Error(`libmedia: failed to download ${file}: HTTP ${res.status}`);
                    mkdirSync(dirname(cached), {recursive: true});
                    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
                }
                cpSync(cached, resolve(dest, "wasm", file));
            }));
        },
    };
}

export default defineConfig({
    plugins: [libmediaAssets()],
});
