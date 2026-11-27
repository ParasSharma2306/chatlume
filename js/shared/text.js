/**
 * ============================================================================
 * Message text rendering
 * ============================================================================
 * Turns an already-escaped message body into HTML: bare URLs become links,
 * WhatsApp's *bold* _italic_ ~strike~ markers become tags, and the live
 * search query is highlighted. Pure string functions — covered by
 * tests/shared.test.mjs. Callers must escape first (see dom.js).
 * ============================================================================
 */
import { escapeHtml, escapeRegExp } from "./dom.js?v=1.10.1";

export const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

/** Up to two initials for an avatar circle. */
export function initialsFor(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Shared links come from the export, so only http(s) may become an href —
 * a "javascript:" URL would otherwise run in this page when clicked.
 */
export function safeHttpUrl(value) {
    const url = String(value || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
}

/**
 * An inline marker only counts at a word edge and around non-space text, as in
 * WhatsApp: "snake_case_name" and "2 * 3 * 4" stay as written. (The leading
 * edge is captured rather than looked behind — Safari < 16.4 can't parse
 * lookbehind.)
 */
function applyMarker(segment, marker, tag) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}${marker}])[${marker}](?!\\s)([^${marker}\\n]*[^${marker}\\s])[${marker}](?![\\p{L}\\p{N}])`, "gu");
    return segment.replace(pattern, `$1<${tag}>$2</${tag}>`);
}

/** WhatsApp's inline markers. Applied to text *between* links only. */
export function applyTextFormatting(segment) {
    // Nothing inside `code` or ```code``` is formatted further.
    return segment.split(/(```[^`]+```|`[^`\n]+`)/).map((part, index) => {
        if (index % 2) return `<code>${part.replace(/^`+|`+$/g, "")}</code>`;
        return applyMarker(applyMarker(applyMarker(part, "*", "strong"), "_", "em"), "~", "s");
    }).join("");
}

/**
 * Length of a matched URL without the punctuation of the sentence around it:
 * "see https://x.y/a." or "(https://x.y)" must not link the "." or ")".
 */
function trimUrl(url) {
    let end = url;
    for (;;) {
        const next = end.replace(/(?:&(?:quot|#39|gt|lt|#96);|[.,!?;:*~'"\]])$/, (tail) =>
            // A ";" closing some other entity (&amp;) belongs to the URL.
            tail === ";" && /&(?:amp);$/.test(end) ? tail : "");
        const unbalanced = next.endsWith(")") && next.split(")").length > next.split("(").length;
        const trimmed = unbalanced ? next.slice(0, -1) : next;
        if (trimmed === end) return end;
        end = trimmed;
    }
}

/**
 * Linkifies URLs and, optionally, applies the formatting markers.
 *
 * The two passes are interleaved rather than chained: running the formatting
 * pass over an already-linkified string rewrote the inside of the links, so
 * .../Foo_bar_baz lost its underscores to an <em> — in the href as well as in
 * the visible text, leaving a dead link. The href is taken verbatim from the
 * escaped source so nothing downstream can rewrite the inside of the tag.
 *
 * @param {string}  escaped                HTML-escaped message text.
 * @param {Object}  [options]
 * @param {boolean} [options.formatting]   Apply *bold* _italic_ ~strike~ (WhatsApp).
 */
export function buildRichText(escaped, { formatting = true } = {}) {
    const format = formatting ? applyTextFormatting : (segment) => segment;
    let out = "";
    let cursor = 0;
    let match;

    URL_PATTERN.lastIndex = 0;
    while ((match = URL_PATTERN.exec(escaped)) !== null) {
        out += format(escaped.slice(cursor, match.index));
        const url = trimUrl(match[0]);
        out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        cursor = match.index + url.length;
        URL_PATTERN.lastIndex = cursor;
    }

    return out + format(escaped.slice(cursor));
}

/**
 * trimUrl for raw (unescaped) text: the same sentence punctuation comes off,
 * spelled as characters instead of entities.
 */
function trimRawUrl(url) {
    let end = url;
    for (;;) {
        const next = end.replace(/[.,!?;:*~'"\]<>]$/, "");
        const unbalanced = next.endsWith(")") && next.split(")").length > next.split("(").length;
        const trimmed = unbalanced ? next.slice(0, -1) : next;
        if (trimmed === end) return end;
        end = trimmed;
    }
}

/**
 * Splits raw text into plain and URL pieces, matching what buildRichText
 * links. `{ url: true }` pieces are http(s) URLs with trailing punctuation
 * already trimmed off.
 * @returns {Array<{ text: string, url: boolean }>}
 */
export function splitLinks(text) {
    const source = String(text ?? "");
    const parts = [];
    // Escaped text has no "<" (it is "&lt;"), so URL_PATTERN runs on through it
    // there; \S keeps raw text linking exactly the same span.
    const pattern = /https?:\/\/\S+/gi;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const url = trimRawUrl(match[0]);
        // "https://" followed only by punctuation trims to nothing worth linking.
        if (!/^https?:\/\/./i.test(url)) {
            pattern.lastIndex = match.index + Math.max(1, url.length);
            continue;
        }
        if (match.index > cursor) parts.push({ text: source.slice(cursor, match.index), url: false });
        parts.push({ text: url, url: true });
        cursor = match.index + url.length;
        pattern.lastIndex = cursor;
    }
    if (cursor < source.length) parts.push({ text: source.slice(cursor), url: false });
    return parts;
}

/** Every http(s) URL in raw message text, in order. */
export function extractLinks(text) {
    const value = String(text ?? "");
    // Most messages have no link; skip the regex walk for them.
    if (!/https?:\/\//i.test(value)) return [];
    return splitLinks(value).filter((part) => part.url).map((part) => part.text);
}

/**
 * buildRichText for Anonymize mode, from RAW text. Masking the whole message
 * first rewrote names, numbers and emails inside URLs too, so
 * https://example.com/u/alice.smith became "…/u/Person A" and the link broke
 * at the space. Here the link target is the original URL, untouched; only
 * what is shown — the surrounding text and the link's visible label — goes
 * through `mask`.
 *
 * @param {string}   raw                   Unescaped message text.
 * @param {Object}   [options]
 * @param {boolean}  [options.formatting]  Apply *bold* _italic_ ~strike~ (WhatsApp).
 * @param {Function} [options.mask]        Visible-text transform (display.text).
 * @param {Function} [options.maskUrl]     Transform for a link's visible text. Pass
 *                                         display.fileName, where "_" separates
 *                                         words as it does in paths ("/Bob_Jones").
 */
export function buildMaskedRichText(raw, { formatting = true, mask = (value) => value, maskUrl = mask } = {}) {
    const format = formatting ? applyTextFormatting : (segment) => segment;
    return splitLinks(raw).map((part) => {
        if (!part.url) return format(escapeHtml(mask(part.text)));
        return `<a href="${escapeHtml(part.text)}" target="_blank" rel="noopener noreferrer">${escapeHtml(maskUrlLabel(part.text, maskUrl))}</a>`;
    }).join("");
}

/**
 * The visible text of a link in Anonymize mode. Percent-escapes are decoded
 * first (as the address bar shows them), so "Alice%20Smith" is recognised as
 * a name; if nothing needed masking the URL is shown exactly as sent.
 */
export function maskUrlLabel(url, mask) {
    let decoded = url;
    try {
        decoded = decodeURI(url);
    } catch {
        // Malformed escapes: mask the URL as written.
    }
    const masked = mask(decoded);
    return masked === decoded ? url : masked;
}

/**
 * Anonymized text for a file meant for sharing (the HTML export), where the
 * original URL can't be kept. Text is masked as on screen; a link whose
 * visible text had to be masked is written as that masked text with a zero-
 * width space after the scheme, so the export's linkifier leaves it as text
 * instead of linking a wrong, half-masked address. Links that needed no
 * masking are untouched and still link.
 */
export function maskTextForSharing(raw, { mask, maskUrl = mask }) {
    return splitLinks(raw).map((part) => {
        if (!part.url) return mask(part.text);
        const label = maskUrlLabel(part.text, maskUrl);
        return label === part.text ? part.text : label.replace(/^(https?:)/i, "$1\u200B");
    }).join("");
}

/** Host name of an http(s) URL ("example.com"), or "" when it can't be parsed. */
export function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
        return "";
    }
}

/**
 * Wraps `query` matches in <span class="hl">, touching text nodes only.
 * Running the query over the whole string would inject <span> into href or
 * class attributes for common queries like "a", "http" or "class".
 */
export function highlightOutsideTags(html, query) {
    // The text is HTML-escaped, so the query must be too ("<3", "&"), and an
    // entity is consumed whole: searching "amp" must not split "&amp;".
    const regex = new RegExp(`(${escapeRegExp(escapeHtml(query))})|&(?:amp|lt|gt|quot|#39|#96);`, "gi");
    return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) => {
        if (tag) return tag;
        return text.replace(regex, (whole, hit) => (hit ? `<span class="hl">${hit}</span>` : whole));
    });
}
