/** Pure search helpers for the Instagram viewer: what a message matches on, and result stepping. */
const AS_IS = { name: (value) => value, text: (value) => value, fileName: (value) => value };

/**
 * Searchable words from one normalized Instagram message, as displayed:
 * pass the anonymize view so a hidden name can't be found by searching it.
 */
export function searchableMessageText(message, display = AS_IS) {
    const mediaNames = (message.mediaItems || []).map((media) => display.fileName(media.name || "")).join(" ");
    const reactions = (message.reactions || []).map((reaction) => `${reaction.reaction || ""} ${display.name(reaction.actor || "")}`).join(" ");
    return `${display.name(message.sender || "")} ${display.text(message.text || "")} ${mediaNames} ${display.text(message.shareText || "")} ${display.text(message.shareLink || "")} ${reactions}`.toLowerCase();
}

export function findMessageSearchResults(messages, query, display = AS_IS) {
    const normalized = String(query || "").trim().toLowerCase();
    if (!normalized) return [];
    return messages
        .filter((message) => message.type === "msg" && searchableMessageText(message, display).includes(normalized))
        .map((message) => message.id);
}

export function nextSearchIndex(index, resultCount, direction) {
    if (!resultCount) return -1;
    const step = direction === "up" ? -1 : 1;
    return (index + step + resultCount) % resultCount;
}
