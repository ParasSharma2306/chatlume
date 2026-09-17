/**
 * ============================================================================
 * In-chat search
 * ============================================================================
 * Live search over senders, message text and attachment names, with a
 * match counter and up/down navigation. Matches are highlighted by the
 * renderer (it reads the query from the input); this module owns the
 * result list, the pointer and the toolbar.
 * ============================================================================
 */
import { $, isTypingTarget } from "../shared/dom.js?v=1.6.2";
import { MAX_RENDERED_ITEMS, SEARCH_DEBOUNCE_MS, state } from "./state.js?v=1.6.2";
import { renderChatList, resetRenderToBottom, syncFocusedSearchResult } from "./render.js?v=1.6.2";

/** The text a message is matched against. */
function getSearchableText(entry) {
    // Defensive: one message without mediaItems would otherwise throw and take
    // down search for the whole chat.
    const mediaNames = (entry.mediaItems || []).map((item) => item.name).join(" ");
    return `${entry.sender || ""} ${entry.text || ""} ${mediaNames}`.toLowerCase();
}

/** Opens or closes the search toolbar; closing clears the query and results. */
export function toggleSearch() {
    const toolbar = $("search-toolbar");
    const input = $("live-search");
    if (!toolbar || !input) return;

    state.isSearchOpen = !toolbar.classList.contains("active");
    toolbar.classList.toggle("active", state.isSearchOpen);

    if (state.isSearchOpen) {
        input.focus();
        return;
    }

    input.value = "";
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    handleSearch("");
    setSearchEmptyState(false);
    resetRenderToBottom();
}

/** Debounced input handler for the search box. */
export function handleSearchInput(event) {
    const query = event.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => handleSearch(query), SEARCH_DEBOUNCE_MS);
}

export function handleSearch(query) {
    state.searchTimer = null;
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
        state.searchResults = [];
        state.searchPointer = -1;
        updateSearchCounter();
        setSearchEmptyState(false);
        renderChatList();
        return;
    }

    state.searchResults = state.messages
        .filter((entry) => entry.type === "msg" && getSearchableText(entry).includes(normalized))
        .map((entry) => entry.id);

    if (!state.searchResults.length) {
        state.searchPointer = -1;
        updateSearchCounter("No matches");
        setSearchEmptyState(true, query.trim());
        // Re-render so highlights from the previous query don't linger.
        renderChatList();
        return;
    }

    state.searchPointer = 0;
    updateSearchCounter();
    setSearchEmptyState(false);
    jumpToMessage(state.searchResults[state.searchPointer]);
}

/** Shows the full-panel "nothing matched" state over the message list. */
export function setSearchEmptyState(visible, query = "") {
    const panel = $("search-empty");
    if (!panel) return;

    if (visible) {
        const queryEl = $("search-empty-query");
        if (queryEl) queryEl.innerText = `"${query}"`;
    }
    panel.hidden = !visible;
}

/** Moves to the previous/next hit, wrapping at either end. */
export function navSearch(direction) {
    if (!state.searchResults.length) return;

    state.searchPointer += direction === "up" ? -1 : 1;
    if (state.searchPointer < 0) {
        state.searchPointer = state.searchResults.length - 1;
    }
    if (state.searchPointer >= state.searchResults.length) {
        state.searchPointer = 0;
    }

    updateSearchCounter();
    jumpToMessage(state.searchResults[state.searchPointer]);
}

export function updateSearchCounter(fallback = "") {
    const counter = $("search-counter");
    if (!counter) return;

    if (fallback) {
        counter.innerText = fallback;
        return;
    }

    counter.innerText = state.searchResults.length
        ? `${state.searchPointer + 1}/${state.searchResults.length}`
        : "";
}

/** Re-centres the virtual window on a message and scrolls it into view. */
export function jumpToMessage(messageId) {
    const index = state.filteredMessages.findIndex((entry) => entry.id === messageId);
    if (index === -1) return;

    state.renderRange.start = Math.max(0, index - 40);
    state.renderRange.end = Math.min(state.filteredMessages.length, state.renderRange.start + MAX_RENDERED_ITEMS);
    renderChatList();

    window.setTimeout(() => {
        const element = $(messageId);
        if (!element) return;
        element.scrollIntoView({ block: "center", behavior: "auto" });
        syncFocusedSearchResult();
    }, 40);
}

/** Ctrl/Cmd+F and "/" jump straight to the in-chat search. */
export function handleSearchShortcut(event) {
    if (!state.filteredMessages.length) return;
    if (isTypingTarget(event.target)) return;

    const isFindCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
    if (!isFindCombo && event.key !== "/") return;
    if (event.altKey) return;

    event.preventDefault();
    if (!state.isSearchOpen) {
        toggleSearch();
    } else {
        $("live-search")?.focus();
    }
}
