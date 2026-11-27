/**
 * ============================================================================
 * Media gallery model
 * ============================================================================
 * Builds the gallery's lists from messages the viewer has already parsed —
 * nothing is re-read from the export. Pure: no DOM, no names resolved here
 * (the gallery passes everything shown through the viewer's Anonymize view).
 * Covered by tests/gallery.test.mjs.
 *
 *   media  photos and videos (stickers are left in the chat)
 *   links  http(s) URLs in message text, plus Instagram shared posts
 *   docs   documents, archives, contact cards, voice notes and other audio
 *
 * Each item keeps the id of the message it came from so "Jump to message"
 * can find it again, and the day marker it sat under so the gallery can say
 * when it was sent (WhatsApp messages carry only a time of day).
 * ============================================================================
 */
import { detectMediaType } from "./media-types.js?v=1.10.0";
import { extractLinks, safeHttpUrl } from "./text.js?v=1.10.0";

/** What a WhatsApp ".txt" export writes for every attachment it left out. */
export const OMITTED_MEDIA_NAME = "Media omitted";

/** Attachment kind → gallery tab. */
const TAB_FOR_KIND = {
    image: "media",
    video: "media",
    audio: "docs",
    document: "docs",
    archive: "docs",
    contact: "docs"
};

/**
 * The attachment's kind ("image", "audio", …). A missing attachment is
 * classified from its file name (WhatsApp marks those kind "missing").
 */
export function attachmentKindOf(mediaItem) {
    if (!mediaItem) return "";
    const kind = mediaItem.kind;
    if (kind && kind !== "missing") return kind;
    return detectMediaType(String(mediaItem.name || "")).kind;
}

/** Which gallery tab an attachment belongs in: "media", "docs" or null (stickers). */
export function galleryTabOf(mediaItem) {
    return TAB_FOR_KIND[attachmentKindOf(mediaItem)] || null;
}

/**
 * @param {Array} messages  A viewer's (filtered) message list: date markers,
 *                          system lines and `{ type: "msg" }` entries.
 * @returns {{
 *   media: Object[], links: Object[], docs: Object[],
 *   missing: { media: number, docs: number }, omitted: number
 * }}  Lists are newest first. Media and docs items carry `kind`
 *     ("image" | "video" | "audio" | "document" | "archive" | "contact").
 */
export function collectGallery(messages) {
    const media = [];
    const links = [];
    const docs = [];
    const missing = { media: 0, docs: 0 };
    let omitted = 0;
    let day = null;

    const list = Array.isArray(messages) ? messages : [];
    for (let index = 0; index < list.length; index += 1) {
        const message = list[index];
        if (!message || typeof message !== "object") continue;
        if (message.type === "date") {
            day = message;
            continue;
        }
        if (message.type !== "msg") continue;

        const base = { messageId: message.id, sender: message.sender, message, day };

        const mediaItems = Array.isArray(message.mediaItems) ? message.mediaItems : [];
        for (const attachment of mediaItems) {
            if (!attachment) continue;
            const kind = attachmentKindOf(attachment);
            const tab = TAB_FOR_KIND[kind];
            if (attachment.status !== "available") {
                if (attachment.name === OMITTED_MEDIA_NAME) omitted += 1;
                else if (tab) missing[tab] += 1;
                continue;
            }
            if (!tab) continue;
            const item = {
                ...base,
                key: `${tab[0]}:${attachment.id}:${message.id}`,
                mediaId: attachment.id,
                kind,
                name: attachment.name,
                size: attachment.size || 0
            };
            (tab === "media" ? media : docs).push(item);
        }

        const seen = new Set();
        const addLink = (url, label = "") => {
            const href = safeHttpUrl(url);
            if (!href || seen.has(href)) return;
            seen.add(href);
            links.push({ ...base, key: `l:${message.id}:${seen.size}`, url: href, label });
        };
        // A shared post first: its caption is a better title than the URL.
        if (message.shareLink) addLink(message.shareLink, message.shareText || "");
        if (typeof message.text === "string" && message.text) extractLinks(message.text).forEach((url) => addLink(url));
    }

    return {
        media: media.reverse(),
        links: links.reverse(),
        docs: docs.reverse(),
        missing,
        omitted
    };
}
