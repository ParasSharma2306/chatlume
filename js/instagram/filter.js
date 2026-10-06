/** Sender filtering for Instagram messages, retaining only relevant date markers. */
export function filterMessagesBySender(messages, selectedSenders) {
    const selected = selectedSenders instanceof Set
        ? selectedSenders
        : new Set(Array.isArray(selectedSenders) ? selectedSenders : []);
    if (!selected.size) return messages;

    const result = [];
    let pendingDate = null;
    for (const item of messages) {
        if (item.type === "date") {
            pendingDate = item;
            continue;
        }
        if (item.type !== "msg" || !selected.has(item.sender)) continue;
        if (pendingDate) result.push(pendingDate);
        result.push(item);
        pendingDate = null;
    }
    return result;
}

export function getInstagramSenders(messages) {
    return [...new Set(messages.filter((item) => item.type === "msg").map((item) => item.sender).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function getInstagramSenderSummary(selectedSenders) {
    if (!selectedSenders?.length) return "All participants";
    if (selectedSenders.length === 1) return selectedSenders[0];
    return `${selectedSenders.length} participants`;
}
