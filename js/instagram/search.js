/**
 * ============================================================================
 * In-thread search
 * ============================================================================
 * Live search over senders, message text, attachment names and shared-post
 * captions — the same surface the WhatsApp viewer searches.
 * ============================================================================
 */
import { $, isTypingTarget } from "../shared/dom.js?v=1.10.0";
import { IG_MAX_RENDERED, IG_SEARCH_DEBOUNCE_MS, igState } from "./state.js?v=1.10.0";
import { renderChatList } from "./render.js?v=1.10.0";
import { findMessageSearchResults, nextSearchIndex } from "./search-model.js?v=1.10.0";
import { display } from "./anonymize.js?v=1.10.0";

export const isSearchOpen = () => Boolean($("ig-search-toolbar")?.classList.contains("active"));

/** Opens or closes the search toolbar; closing clears the query and results. */
export function toggleSearch() {
    const bar = $("ig-search-toolbar");
    const input = $("ig-live-search");
    if (!bar || !input) return;
    const open = bar.classList.toggle("active");
    $("ig-search-toggle")?.setAttribute("aria-expanded", String(open));
    if (open) {
        // Search results live in the chat, so anything covering it steps aside.
        document.dispatchEvent(new CustomEvent("chatlume:show-chat"));
        input.focus();
        return;
    }
    input.value = "";
    clearTimeout(igState.searchTimer);
    igState.searchTimer = null;
    igState.searchQuery = "";
    igState.searchResults = [];
    igState.searchPointer = -1;
    updateSearchCounter();
    setSearchEmptyState(false);
    renderChatList();
    $("ig-search-toggle")?.focus({ preventScroll: true });
}

/** Debounced input handler for the search box. */
export function handleSearchInput(event) {
    clearTimeout(igState.searchTimer);
    const query = event.target.value;
    igState.searchTimer = setTimeout(() => runSearch(query), IG_SEARCH_DEBOUNCE_MS);
}

export function runSearch(query) {
    clearTimeout(igState.searchTimer);
    igState.searchTimer = null;
    const normalized = String(query || "").trim().toLowerCase();
    igState.searchQuery = normalized;
    if (!normalized) {
        igState.searchResults = [];
        igState.searchPointer = -1;
        updateSearchCounter();
        setSearchEmptyState(false);
        renderChatList();
        return;
    }
    igState.searchResults = findMessageSearchResults(igState.filteredMessages, normalized, display);
    if (!igState.searchResults.length) {
        igState.searchPointer = -1;
        updateSearchCounter("No matches");
        setSearchEmptyState(true, query.trim());
        // Re-render so highlights from the previous query don't linger.
        renderChatList();
        return;
    }
    igState.searchPointer = 0;
    updateSearchCounter();
    setSearchEmptyState(false);
    jumpToMessage(igState.searchResults[0]);
}

/** Shows the full-panel "nothing matched" state over the message list. */
export function setSearchEmptyState(visible, query = "") {
    const panel = $("ig-search-empty");
    if (!panel) return;
    if (visible) {
        const queryEl = $("ig-search-empty-query");
        if (queryEl) queryEl.innerText = `"${query}"`;
    }
    panel.hidden = !visible;
}

/** Moves to the previous/next hit, wrapping at either end. */
export function navSearch(direction) {
    if (!igState.searchResults.length) return;
    igState.searchPointer = nextSearchIndex(igState.searchPointer, igState.searchResults.length, direction);
    updateSearchCounter();
    jumpToMessage(igState.searchResults[igState.searchPointer]);
}

export function updateSearchCounter(fallback = "") {
    const el = $("ig-search-counter");
    if (!el) return;
    el.innerText = fallback || (igState.searchResults.length ? `${igState.searchPointer + 1}/${igState.searchResults.length}` : "");
}

/** How long a message stays highlighted after "Jump to message". */
const FLASH_MS = 1800;
let flashTimer = 0;

/**
 * Re-centres the virtual window on a message and scrolls it into view.
 * `flash` briefly highlights it and `focus` moves keyboard focus to it — the
 * gallery's "Jump to message" uses both. Returns false if it isn't listed.
 */
export function jumpToMessage(id, { flash = false, focus = false } = {}) {
    const idx = igState.filteredMessages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    if (flash) {
        // Read by the renderer, so the highlight survives a re-render.
        igState.flashMessageId = id;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            if (igState.flashMessageId !== id) return;
            igState.flashMessageId = "";
            $(id)?.classList.remove("msg-flash");
        }, FLASH_MS);
    }
    igState.renderRange.start = Math.max(0, idx - 40);
    igState.renderRange.end = Math.min(igState.filteredMessages.length, igState.renderRange.start + IG_MAX_RENDERED);
    renderChatList();
    // Scroll before the browser reports the swapped content as a scroll to the
    // edge: waiting let the list page away and drop the match from the DOM.
    const scrollToMatch = () => $(id)?.scrollIntoView({ block: "center", behavior: "auto" });
    scrollToMatch();
    if (focus) focusMessage(id);
    setTimeout(() => {
        scrollToMatch();
        if (focus) focusMessage(id);
    }, 40);
    return true;
}

function focusMessage(id) {
    const row = $(id);
    if (!row) return;
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
}

/** Enter / Shift+Enter step through the matches. */
export function handleSearchKeydown(event) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    // Enter before the debounce fires runs the query as typed.
    if (igState.searchTimer) runSearch(event.target.value);
    else navSearch(event.shiftKey ? "up" : "down");
}

/** Ctrl/Cmd+F and "/" jump straight to the in-thread search. */
export function handleSearchShortcut(event) {
    if (!igState.filteredMessages.length) return;
    if (isTypingTarget(event.target)) return;

    const isFindCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
    if (!isFindCombo && event.key !== "/") return;
    if (event.altKey) return;

    event.preventDefault();
    if (isSearchOpen()) {
        $("ig-live-search")?.focus();
    } else {
        toggleSearch();
    }
}
