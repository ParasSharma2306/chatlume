/**
 * ============================================================================
 * Instagram viewer state
 * ============================================================================
 * One mutable object shared by every module of the Instagram viewer. The
 * media and render fields mirror the WhatsApp viewer's so the shared
 * helpers (shared/media-urls.js, shared/virtual-list.js) work on both.
 * ============================================================================
 */

export const IG_BATCH_SIZE = 60;
export const IG_MAX_RENDERED = 180;
export const IG_SEARCH_DEBOUNCE_MS = 120;

export const igState = {
    // ── Export ───────────────────────────────────────────────────────────
    zipEntries: [],          // every entry in the opened ZIP
    zipReader: null,
    threads: [],             // { folder, files[] } per conversation folder
    selectedFile: null,

    // ── Parsed thread ────────────────────────────────────────────────────
    messages: [],
    filteredMessages: [],
    messageOnlyCount: 0,
    myName: "",
    chatTitle: "Instagram DMs",

    // ── Analytics ────────────────────────────────────────────────────────
    colorMap: {},
    senderStats: {},
    emojiStats: {},
    hourlyStats: Array(24).fill(0),
    mediaCount: 0,

    // ── Media (see shared/media-urls.js) ─────────────────────────────────
    mediaStore: new Map(),
    mediaLookup: new Map(),
    mediaUrls: new Set(),
    activeMediaId: "",

    // ── Rendering / search ───────────────────────────────────────────────
    renderRange: { start: 0, end: 0 },
    searchResults: [],
    searchPointer: -1,
    searchTimer: null,

    // ── Session ──────────────────────────────────────────────────────────
    isLoading: false,
    // Picking a second ZIP while the first is still being scanned would
    // otherwise let the older scan finish last and overwrite the entries.
    loadGeneration: 0,
    // Same guard for picking a second conversation mid-parse.
    threadGeneration: 0
};
