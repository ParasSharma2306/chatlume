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
import { escapeHtml, escapeRegExp } from "./dom.js?v=1.9.0";

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
