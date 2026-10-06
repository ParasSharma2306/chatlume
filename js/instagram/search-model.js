/** Searchable words from one normalized Instagram message. */
export function searchableMessageText(message) {
    const mediaNames = (message.mediaItems || []).map((media) => media.name).join(" ");
    const reactions = (message.reactions || []).map((reaction) => `${reaction.reaction || ""} ${reaction.actor || ""}`).join(" ");
    return `${message.sender || ""} ${message.text || ""} ${mediaNames} ${message.shareText || ""} ${message.shareLink || ""} ${reactions}`.toLowerCase();
}

export function findMessageSearchResults(messages, query) {
    const normalized = String(query || "").trim().toLowerCase();
    if (!normalized) return [];
    return messages
        .filter((message) => message.type === "msg" && searchableMessageText(message).includes(normalized))
        .map((message) => message.id);
}

export function nextSearchIndex(index, resultCount, direction) {
    if (!resultCount) return -1;
    const step = direction === "up" ? -1 : 1;
    return (index + step + resultCount) % resultCount;
}
