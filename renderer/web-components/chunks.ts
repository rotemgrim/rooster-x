import {html, nothing} from "lit";

/** A file's chunk map (IEngineFile.chunks) as a bar, brighter green where more is downloaded. */
export function chunksBar(chunks: string | undefined) {
    if (!chunks) {
        return nothing;
    }
    // one gradient stop pair per 1% slice; brightness = how complete it is
    const step = 100 / chunks.length;
    const stops = [...chunks].map((c, i) => {
        const color = `rgba(107, 236, 93, ${(+c / 9).toFixed(2)})`;
        return `${color} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`;
    });
    const ready = chunks.search(/[^9]/);
    const readyPct = ready === -1 ? 100 : ready;
    return html`<div class="engine-chunks"
        title="${readyPct}% downloaded from the start"
        style="background: linear-gradient(to right, ${stops.join(", ")}), rgba(0, 0, 0, 0.45)"></div>`;
}
