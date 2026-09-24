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
import { escapeRegExp } from "./dom.js?v=1.7.3";

export const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

/** WhatsApp's inline markers. Applied to text *between* links only. */
export function applyTextFormatting(segment) {
    return segment
        .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
        .replace(/_([^_\n]+)_/g, "<em>$1</em>")
        .replace(/~([^~\n]+)~/g, "<s>$1</s>");
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
        out += `<a href="${match[0]}" target="_blank" rel="noopener noreferrer">${match[0]}</a>`;
        cursor = match.index + match[0].length;
    }

    return out + format(escaped.slice(cursor));
}

/**
 * Wraps `query` matches in <span class="hl">, touching text nodes only.
 * Running the query over the whole string would inject <span> into href or
 * class attributes for common queries like "a", "http" or "class".
 */
export function highlightOutsideTags(html, query) {
    const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
    return html.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, text) => {
        if (tag) return tag;
        return text.replace(regex, '<span class="hl">$1</span>');
    });
}
