/**
 * ============================================================================
 * WhatsApp viewer state
 * ============================================================================
 * One mutable object shared by every module of the WhatsApp viewer. Modules
 * import it directly rather than passing it around; `resetChatState()` in
 * session.js returns the per-chat fields to their defaults before each load.
 * ============================================================================
 */
import { DEFAULT_SETTINGS } from "../settings.js?v=1.7.2";

/** Rows added to the virtual window per scroll step. */
export const BATCH_SIZE = 60;
/** Upper bound on rows in the DOM at once. */
export const MAX_RENDERED_ITEMS = 180;
/** Debounce for the live search box. */
export const SEARCH_DEBOUNCE_MS = 120;

export const STORAGE_KEYS = {
    theme: "chatlume-theme",
    settings: "chatlume-settings",
    lastImport: "chatlume-last-import",
    // Set the first time a chat is kept, so users who never turned the feature
    // on don't pay for a storage lookup at boot.
    persistUsed: "chatlume-persist-used"
};

export const SITE_URL = "https://chatlume.app";
export const ISSUES_URL = "https://github.com/ParasSharma2306/chatlume/issues/new";

export const state = {
    // ── Parsed chat ──────────────────────────────────────────────────────
    messages: [],            // every entry: { type: "date" | "system" | "msg", ... }
    filteredMessages: [],    // what the list renders from (all messages or filtered by senders)
    messageOnlyCount: 0,     // entries of type "msg"
    selectedSenders: [],     // active sender filter (array of sender names, empty for all participants)
    myName: "",              // the participant whose messages sit on the right
    chatTitle: "Chat History",
    inferredDateOrder: "DMY",
    parseDiagnostics: { unrecognizedHeaders: 0, unrecognizedSample: "" },

    // ── Analytics ────────────────────────────────────────────────────────
    colorMap: {},
    senderStats: Object.create(null),
    emojiStats: {},
    hourlyStats: Array(24).fill(0),
    mediaCount: 0,
    mediaMissingCount: 0,

    // ── Media (see shared/media-urls.js) ─────────────────────────────────
    mediaStore: new Map(),
    mediaLookup: new Map(),
    mediaUrls: new Set(),
    activeMediaId: "",
    zipReader: null,

    // ── Rendering / search ───────────────────────────────────────────────
    renderRange: { start: 0, end: 0 },
    searchResults: [],
    searchPointer: -1,
    searchTimer: null,
    isSearchOpen: false,

    // ── Session ──────────────────────────────────────────────────────────
    selectedFile: null,
    settings: { ...DEFAULT_SETTINGS },
    profileObjectUrl: "",
    isLoading: false,
    // Bumped on every load so a superseded parse or copy can tell it lost.
    loadGeneration: 0,

    // ── Persistent Storage (Beta) ────────────────────────────────────────
    storageSupported: false,
    storedImports: [],
    storedImportsLoaded: false,
    activeImportId: "",
    persistJob: null
};
