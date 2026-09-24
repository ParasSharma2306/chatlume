/**
 * ============================================================================
 * In-thread search
 * ============================================================================
 * Live search over senders, message text, attachment names and shared-post
 * captions — the same surface the WhatsApp viewer searches.
 * ============================================================================
 */
import { $, isTypingTarget } from "../shared/dom.js?v=1.7.3";
import { IG_MAX_RENDERED, IG_SEARCH_DEBOUNCE_MS, igState } from "./state.js?v=1.7.3";
import { renderChatList, resetRenderToBottom, syncFocusedSearchResult } from "./render.js?v=1.7.3";

function getSearchableText(entry) {
    const mediaNames = (entry.mediaItems || []).map((m) => m.name).join(" ");
    return `${entry.sender || ""} ${entry.text || ""} ${mediaNames} ${entry.shareText || ""}`.toLowerCase();
}

export const isSearchOpen = () => Boolean($("ig-search-toolbar")?.classList.contains("active"));

/** Opens or closes the search toolbar; closing clears the query and results. */
export function toggleSearch() {
    const bar = $("ig-search-toolbar");
    const input = $("ig-live-search");
    if (!bar || !input) return;
    const open = bar.classList.toggle("active");
    $("ig-search-toggle")?.setAttribute("aria-expanded", String(open));
    if (open) { input.focus(); return; }
    input.value = "";
    clearTimeout(igState.searchTimer);
    igState.searchResults = [];
    igState.searchPointer = -1;
    updateSearchCounter();
    setSearchEmptyState(false);
    resetRenderToBottom();
    $("ig-search-toggle")?.focus({ preventScroll: true });
}

/** Debounced input handler for the search box. */
export function handleSearchInput(event) {
    clearTimeout(igState.searchTimer);
    igState.searchTimer = setTimeout(() => runSearch(event.target.value), IG_SEARCH_DEBOUNCE_MS);
}

export function runSearch(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        igState.searchResults = [];
        igState.searchPointer = -1;
        updateSearchCounter();
        setSearchEmptyState(false);
        renderChatList();
        return;
    }
    igState.searchResults = igState.messages
        .filter((m) => m.type === "msg" && getSearchableText(m).includes(normalized))
        .map((m) => m.id);
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
    igState.searchPointer += direction === "up" ? -1 : 1;
    if (igState.searchPointer < 0) igState.searchPointer = igState.searchResults.length - 1;
    if (igState.searchPointer >= igState.searchResults.length) igState.searchPointer = 0;
    updateSearchCounter();
    jumpToMessage(igState.searchResults[igState.searchPointer]);
}

export function updateSearchCounter(fallback = "") {
    const el = $("ig-search-counter");
    if (!el) return;
    el.innerText = fallback || (igState.searchResults.length ? `${igState.searchPointer + 1}/${igState.searchResults.length}` : "");
}

/** Re-centres the virtual window on a message and scrolls it into view. */
export function jumpToMessage(id) {
    const idx = igState.filteredMessages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    igState.renderRange.start = Math.max(0, idx - 40);
    igState.renderRange.end = Math.min(igState.filteredMessages.length, igState.renderRange.start + IG_MAX_RENDERED);
    renderChatList();
    setTimeout(() => {
        $(id)?.scrollIntoView({ block: "center", behavior: "auto" });
        syncFocusedSearchResult();
    }, 40);
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
