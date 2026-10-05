/**
 * Messenger viewer state. Its media fields match the shared ZIP media helpers;
 * the remaining fields are deliberately separate from the other viewers.
 */
export const messengerState = {
    zipEntries: [],
    zipReader: null,
    threads: [],
    selectedFile: null,
    messages: [],
    filteredMessages: [],
    messageOnlyCount: 0,
    myName: "",
    chatTitle: "Facebook Messenger",
    mediaCount: 0,
    mediaStore: new Map(),
    mediaLookup: new Map(),
    mediaUrls: new Set(),
    activeMediaId: "",
    renderRange: { start: 0, end: 0 },
    isLoading: false,
    loadGeneration: 0,
    threadGeneration: 0
};
