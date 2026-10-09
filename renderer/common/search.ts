/** Lowercase, drop accents and punctuation: "Amélie" -> "amelie", "Spider-Man: No Way" -> "spider man no way". */
export function normalize(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

// "dune 2" should find "Dune: Part Two" and "rocky ii" "Rocky 2".
const NUMBER_WORDS: Record<string, string> = {
    one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9",
};
const canonical = (word: string) => NUMBER_WORDS[word] ?? word;

/** Edit distance counting a swap of two neighbouring letters as one edit, so "brekaing" is 1 away from "breaking". */
function editDistance(a: string, b: string): number {
    const d: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
        d.push([i]);
    }
    for (let j = 1; j <= b.length; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/** How well one typed word matches one title word: 2 = same or the start of it, 1 = a typo away, 0 = no match. */
function wordMatch(queryWord: string, titleWord: string): number {
    if (titleWord.startsWith(queryWord) || canonical(titleWord) === canonical(queryWord)) {
        return 2;
    }
    // Short words get no typo allowance, or "bear" would match "bar" and "beer".
    if (queryWord.length < 5) {
        return 0;
    }
    const allowed = queryWord.length >= 8 ? 2 : 1;
    // Also compare against the start of the title word, for a typo in a word still being typed.
    const prefix = titleWord.slice(0, queryWord.length);
    return Math.min(editDistance(queryWord, titleWord), editDistance(queryWord, prefix)) <= allowed ? 1 : 0;
}

/**
 * Scores a title against a search query; 0 means it doesn't match. Every typed
 * word has to match a word of the title, so extra words narrow the results.
 */
export function searchScore(title: string, query: string): number {
    const t = normalize(title);
    const q = normalize(query);
    if (!q || !t) {
        return 0;
    }
    // Shorter titles first within a tier: they are the closer match.
    const tieBreak = Math.min(t.length, 999) / 1000;
    if (t === q) {
        return 100;
    }
    if (t.startsWith(q)) {
        return 90 - tieBreak;
    }
    if (` ${t}`.includes(` ${q}`)) {
        return 80 - tieBreak;
    }
    // "spiderman" vs "Spider-Man", "lastofus" vs "The Last of Us". Short queries
    // would match inside any word this way ("b" in "impossible").
    const squashed = q.replace(/ /g, "");
    if (squashed.length >= 4 && t.replace(/ /g, "").includes(squashed)) {
        return 70 - tieBreak;
    }
    const titleWords = t.split(" ");
    let total = 0;
    for (const queryWord of q.split(" ")) {
        const best = Math.max(...titleWords.map(titleWord => wordMatch(queryWord, titleWord)));
        if (best === 0) {
            return 0;
        }
        total += best;
    }
    // 50-60: all words matched exactly or by prefix score higher than ones with typos.
    return 50 + (10 * total) / (2 * q.split(" ").length) - tieBreak;
}

/** The items whose title matches query, best match first. */
export function searchByTitle<T extends {title?: string | null}>(items: T[], query: string): T[] {
    return items
        .map(item => ({item, score: searchScore(item.title || "", query)}))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(r => r.item);
}
