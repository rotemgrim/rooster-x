import {defineConfig, type Plugin} from "vite";
import {cpSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {dirname, extname, resolve, sep} from "node:path";

const AVPLAYER_DIST = resolve(__dirname, "node_modules/@libmedia/avplayer/dist/esm");
const LIBMEDIA_VERSION: string = JSON.parse(
    readFileSync(resolve(__dirname, "node_modules/@libmedia/avplayer/package.json"), "utf-8")).version;
const WASM_CACHE = resolve(__dirname, `node_modules/.cache/libmedia-wasm/${LIBMEDIA_VERSION}`);
const WASM_BASE_URL = `https://cdn.jsdelivr.net/gh/zhaohappy/libmedia@${LIBMEDIA_VERSION}/dist`;

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

/** Downloads the decoders missing from the cache. */
async function ensureWasmCache() {
    await Promise.all(WASM_FILES.map(async file => {
        const cached = resolve(WASM_CACHE, file);
        if (existsSync(cached)) return;
        const res = await fetch(`${WASM_BASE_URL}/${file}`);
        if (!res.ok) throw new Error(`libmedia: failed to download ${file}: HTTP ${res.status}`);
        mkdirSync(dirname(cached), {recursive: true});
        writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
    }));
}

/** Maps a /libmedia/... URL path to its source file, or null if it escapes the roots. */
function libmediaSourceFile(urlPath: string): string | null {
    const [root, rest] = urlPath.startsWith("/libmedia/wasm/")
        ? [WASM_CACHE, urlPath.slice("/libmedia/wasm/".length)]
        : [AVPLAYER_DIST, urlPath.slice("/libmedia/".length)];
    const file = resolve(root, decodeURIComponent(rest));
    return file.startsWith(root + sep) ? file : null;
}

/**
 * Serves libmedia's AVPlayer under /libmedia/: its ESM dist (a webpack build
 * that lazy-loads its own NN.avplayer.js chunks relative to the entry, so
 * Vite can't bundle it) and the decoder .wasm files under /libmedia/wasm/.
 * The dev server serves them straight from node_modules and the download
 * cache; the build copies them into the output, which the Go binary embeds,
 * so playback needs no internet access.
 *
 * Also mirrors server/isolation.go's headers in dev: the player page and its
 * assets are cross-origin isolated so libmedia can use threads.
 */
function libmediaAssets(): Plugin {
    let outDir = "";
    return {
        name: "libmedia-assets",
        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },
        buildStart: ensureWasmCache,
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const path = (req.url || "").split("?")[0];
                if (path === "/player.html" || path.startsWith("/libmedia/")) {
                    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
                }
                if (!path.startsWith("/libmedia/")) return next();
                const file = libmediaSourceFile(path);
                if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
                res.setHeader("Content-Type", extname(file) === ".wasm" ? "application/wasm" : "text/javascript");
                createReadStream(file).pipe(res);
            });
        },
        writeBundle() {
            cpSync(AVPLAYER_DIST, resolve(outDir, "libmedia"), {recursive: true});
            cpSync(WASM_CACHE, resolve(outDir, "libmedia/wasm"), {recursive: true});
        },
    };
}

export default defineConfig({
    plugins: [libmediaAssets()],
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                player: resolve(__dirname, "player.html"),
            },
        },
    },
});
