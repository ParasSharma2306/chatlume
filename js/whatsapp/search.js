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
import { $, isTypingTarget } from "../shared/dom.js?v=1.10.1";
import { MAX_RENDERED_ITEMS, SEARCH_DEBOUNCE_MS, state } from "./state.js?v=1.10.1";
import { renderChatList, syncFocusedSearchResult } from "./render.js?v=1.10.1";
import { display } from "./anonymize.js?v=1.10.1";

/**
 * The text a message is matched against — what is on screen, so in Anonymize
 * mode "Person A" finds Person A and a hidden name can't be probed for.
 */
function getSearchableText(entry) {
    // Defensive: one message without mediaItems would otherwise throw and take
    // down search for the whole chat.
    const mediaNames = (entry.mediaItems || []).map((item) => display.fileName(item.name)).join(" ");
    return `${display.name(entry.sender || "")} ${display.text(entry.text || "")} ${mediaNames}`.toLowerCase();
}

/** Opens or closes the search toolbar; closing clears the query and results. */
export function toggleSearch() {
    const toolbar = $("search-toolbar");
    const input = $("live-search");
    if (!toolbar || !input) return;

    state.isSearchOpen = !toolbar.classList.contains("active");
    toolbar.classList.toggle("active", state.isSearchOpen);
    $("search-toggle")?.setAttribute("aria-expanded", String(state.isSearchOpen));

    if (state.isSearchOpen) {
        // Search results live in the chat, so anything covering it steps aside.
        document.dispatchEvent(new CustomEvent("chatlume:show-chat"));
        input.focus();
        return;
    }

    input.value = "";
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    handleSearch("");
    setSearchEmptyState(false);
    $("search-toggle")?.focus({ preventScroll: true });
}

/** Debounced input handler for the search box. */
export function handleSearchInput(event) {
    const query = event.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => handleSearch(query), SEARCH_DEBOUNCE_MS);
}

export function handleSearch(query) {
    // Direct searches (including sender-filter changes) must cancel a pending
    // debounced input, or its older query can overwrite these results later.
    window.clearTimeout(state.searchTimer);
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

    state.searchResults = state.filteredMessages
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

/** How long a message stays highlighted after "Jump to message". */
const FLASH_MS = 1800;
let flashTimer = 0;

/**
 * Re-centres the virtual window on a message and scrolls it into view.
 * `flash` briefly highlights it and `focus` moves keyboard focus to it — the
 * gallery's "Jump to message" uses both. Returns false if it isn't listed.
 */
export function jumpToMessage(messageId, { flash = false, focus = false } = {}) {
    const index = state.filteredMessages.findIndex((entry) => entry.id === messageId);
    if (index === -1) return false;

    if (flash) {
        // Read by the renderer, so the highlight survives a re-render.
        state.flashMessageId = messageId;
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
            if (state.flashMessageId !== messageId) return;
            state.flashMessageId = "";
            $(messageId)?.classList.remove("msg-flash");
        }, FLASH_MS);
    }

    state.renderRange.start = Math.max(0, index - 40);
    state.renderRange.end = Math.min(state.filteredMessages.length, state.renderRange.start + MAX_RENDERED_ITEMS);
    renderChatList();

    // Scroll before the browser reports the swapped content as a scroll to the
    // edge: waiting let the list page away and drop the match from the DOM.
    const scrollToMatch = () => $(messageId)?.scrollIntoView({ block: "center", behavior: "auto" });
    scrollToMatch();
    if (focus) focusMessage(messageId);
    window.setTimeout(() => {
        scrollToMatch();
        if (focus) focusMessage(messageId);
    }, 40);
    return true;
}

function focusMessage(messageId) {
    const row = $(messageId);
    if (!row) return;
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
}

/** Enter / Shift+Enter step through the matches. */
export function handleSearchKeydown(event) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    // Enter before the debounce fires runs the query as typed.
    if (state.searchTimer) handleSearch(event.target.value);
    else navSearch(event.shiftKey ? "up" : "down");
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
