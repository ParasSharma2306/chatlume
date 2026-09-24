/**
 * ============================================================================
 * Sender filtering
 * ============================================================================
 * Filters the displayed messages by one or multiple participants simultaneously.
 *
 * Preserves date markers for dates on which any of the selected senders have
 * messages so day dividers and "Go to Date" continue to work. Works together
 * with in-chat search and date filters.
 * ============================================================================
 */
import { $, escapeAttribute, escapeHtml } from "../shared/dom.js?v=1.7.1";
import { state } from "./state.js?v=1.7.1";

/**
 * Returns true if the sender represents the current user ("You" or myName).
 *
 * @param {string} sender
 * @param {string} [myName]
 * @returns {boolean}
 */
export function isMeSender(sender, myName = state.myName) {
    if (!sender) return false;
    return sender.toLowerCase() === (myName || "").toLowerCase() || sender === "You";
}

/**
 * Pure function: filters a message list by one or more senders (OR semantics).
 *
 * If senders is empty or null, returns the messages array unchanged.
 * If senders are specified, keeps only messages from those senders, plus date
 * markers that precede at least one message from those senders.
 *
 * System messages are not from any participant, so when filtering by sender(s),
 * system messages are excluded.
 * When senders is empty ("All participants"), system messages, date markers,
 * and all participant messages are retained.
 *
 * @param {Array<Object>} messages          Original message list
 * @param {string|string[]|Set<string>} [senders]  Target sender name or collection
 * @returns {Array<Object>}                  Filtered message list
 */
export function filterMessagesBySender(messages, senders) {
    if (!senders) {
        return messages;
    }

    let senderList = [];
    if (typeof senders === "string") {
        const trimmed = senders.trim();
        if (!trimmed) return messages;
        senderList = [trimmed];
    } else if (senders instanceof Set || Array.isArray(senders)) {
        senderList = Array.from(senders)
            .map((s) => (typeof s === "string" ? s.trim() : ""))
            .filter(Boolean);
        if (!senderList.length) return messages;
    } else {
        return messages;
    }

    const senderSet = new Set(senderList);

    const filtered = [];
    let currentDateMarker = null;
    let dateMarkerAdded = false;

    for (const item of messages) {
        if (item.type === "date") {
            currentDateMarker = item;
            dateMarkerAdded = false;
            continue;
        }

        if (item.type === "msg") {
            // Sender names are the parser's existing identity key. Keep the
            // comparison exact so distinct participants named "Sam" and
            // "sam" do not get merged by a case-insensitive match.
            const matches = senderSet.has(item.sender);

            if (matches) {
                if (currentDateMarker && !dateMarkerAdded) {
                    filtered.push(currentDateMarker);
                    dateMarkerAdded = true;
                }
                filtered.push(item);
            }
        }
    }

    return filtered;
}

/**
 * Returns a sorted list of unique sender names from the loaded chat.
 * Sorted by message count descending, then alphabetically.
 *
 * @param {Object} [senderStats]  Record of sender name to message count
 * @returns {string[]}
 */
export function getChatSenders(senderStats = state.senderStats) {
    return Object.keys(senderStats || {}).sort((a, b) => {
        const countDiff = (senderStats[b] || 0) - (senderStats[a] || 0);
        if (countDiff !== 0) return countDiff;
        return a.localeCompare(b);
    });
}

/**
 * Returns human-readable label for the collapsed sender filter button.
 *
 * @param {string[]|Set<string>} [selectedSenders]
 * @returns {string}
 */
export function getSenderFilterSummary(selectedSenders = state.selectedSenders) {
    const list = Array.isArray(selectedSenders) ? selectedSenders : Array.from(selectedSenders || []);
    if (!list.length) {
        return "All participants";
    }
    if (list.length === 1) {
        const sender = list[0];
        return isMeSender(sender) && sender !== "You" ? `${sender} (You)` : sender;
    }
    return `${list.length} participants`;
}

/**
 * Populates the sender filter checkbox popover with participants from the loaded chat.
 */
export function populateSenderFilter() {
    const listEl = $("sender-filter-list");
    const container = $("sender-filter-container");
    const summaryEl = $("sender-filter-summary");
    const searchEl = $("sender-filter-search");
    if (!listEl || !container) return;

    const senders = getChatSenders(state.senderStats);
    if (!senders.length) {
        container.hidden = true;
        listEl.innerHTML = "";
        if (searchEl) searchEl.value = "";
        return;
    }

    if (searchEl) searchEl.value = "";

    const currentSelected = new Set(state.selectedSenders || []);
    const isAll = currentSelected.size === 0;

    let html = `
        <label class="sender-filter-item">
            <input type="checkbox" class="sender-filter-checkbox" value="" ${isAll ? "checked" : ""}>
            <span class="sender-filter-name">All participants</span>
        </label>
    `;

    for (const sender of senders) {
        const isMe = isMeSender(sender);
        const label = isMe && sender !== "You" ? `${sender} (You)` : sender;
        const count = state.senderStats[sender] || 0;
        const checked = currentSelected.has(sender) ? "checked" : "";

        html += `
            <label class="sender-filter-item">
                <input type="checkbox" class="sender-filter-checkbox" value="${escapeAttribute(sender)}" ${checked}>
                <span class="sender-filter-name" title="${escapeAttribute(label)}">${escapeHtml(label)}</span>
                <span class="sender-filter-count">${count.toLocaleString()}</span>
            </label>
        `;
    }

    listEl.innerHTML = html;
    filterSenderList("");
    if (summaryEl) {
        setSenderFilterSummary(summaryEl, getSenderFilterSummary(state.selectedSenders));
    }
    syncSenderFilterClearButton();
    container.hidden = false;
}

/** Narrows the visible participant rows without changing the active filter. */
export function filterSenderList(query) {
    const listEl = $("sender-filter-list");
    const noResults = $("sender-filter-no-results");
    const clearButton = $("sender-filter-search-clear");
    if (!listEl) return;

    const normalized = String(query || "").trim().toLowerCase();
    let visibleCount = 0;
    listEl.querySelectorAll(".sender-filter-item").forEach((item) => {
        const name = item.querySelector(".sender-filter-name")?.textContent || "";
        const visible = !normalized || name.toLowerCase().includes(normalized);
        item.hidden = !visible;
        if (visible) visibleCount += 1;
    });
    if (noResults) noResults.hidden = visibleCount > 0;
    if (clearButton) clearButton.hidden = !String(query || "").length;
}

/**
 * Syncs the visibility of the clear button next to the filter button.
 */
export function syncSenderFilterClearButton() {
    const clearBtn = $("sender-filter-clear");
    if (clearBtn) {
        const hasSelection = Boolean(state.selectedSenders && state.selectedSenders.length > 0);
        clearBtn.hidden = !hasSelection;
    }
}

/**
 * Updates the header meta text to reflect the filter count if filtered.
 */
export function updateFilterHeaderMeta() {
    const headerMeta = $("header-meta");
    if (!headerMeta) return;

    const withMedia = state.mediaCount ? ` • ${state.mediaCount.toLocaleString()} media` : "";
    const hasSelection = Boolean(state.selectedSenders && state.selectedSenders.length > 0);

    if (!hasSelection) {
        headerMeta.innerText = `${state.messageOnlyCount.toLocaleString()} messages${withMedia}`;
        return;
    }

    const filteredCount = state.selectedSenders.reduce(
        (total, sender) => total + (state.senderStats[sender] || 0),
        0
    );
    headerMeta.innerText = `${filteredCount.toLocaleString()} of ${state.messageOnlyCount.toLocaleString()} messages${withMedia}`;
}

/**
 * Sets the active sender filter, recalculates filteredMessages,
 * coordinates with search, and updates the display.
 *
 * @param {string|string[]|Set<string>} senders
 * @param {Object} [options]
 * @param {Function} [options.onRender]
 * @param {Function} [options.onSearch]
 * @param {Function} [options.onToast]
 * @param {boolean} [options.silent]
 */
export function applySenderFilter(senders, { onRender, onSearch, onToast, silent = false } = {}) {
    let list = [];
    if (typeof senders === "string") {
        const trimmed = senders.trim();
        list = trimmed ? [trimmed] : [];
    } else if (senders instanceof Set || Array.isArray(senders)) {
        list = Array.from(senders)
            .map((s) => (typeof s === "string" ? s.trim() : ""))
            .filter(Boolean);
    }

    // Checkbox changes already produce unique values, but callers can pass an
    // array directly. De-duplicate it so counts, labels, and export metadata
    // always describe the actual OR set.
    list = [...new Set(list)];
    state.selectedSenders = list;

    const summaryEl = $("sender-filter-summary");
    if (summaryEl) {
        setSenderFilterSummary(summaryEl, getSenderFilterSummary(state.selectedSenders));
    }

    syncSenderFilterClearButton();

    // Sync checkboxes in dropdown list
    const listEl = $("sender-filter-list");
    if (listEl) {
        const selectedSet = new Set(list);
        const isAll = list.length === 0;
        const checkboxes = listEl.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
            if (cb.value === "") {
                cb.checked = isAll;
            } else {
                cb.checked = selectedSet.has(cb.value);
            }
        });
    }

    state.filteredMessages = filterMessagesBySender(state.messages, state.selectedSenders);
    updateFilterHeaderMeta();

    const liveSearch = $("live-search");
    if (state.isSearchOpen && liveSearch) {
        if (typeof onSearch === "function") {
            onSearch(liveSearch.value);
        }
    } else if (typeof onRender === "function") {
        onRender();
    }

    if (!silent && typeof onToast === "function") {
        if (list.length === 0) {
            onToast("Showing all participants");
        } else if (list.length === 1) {
            onToast(`Showing messages from ${list[0]}`);
        } else {
            onToast(`Showing messages from ${list.length} participants`);
        }
    }
}

/**
 * Toggles a sender checkbox in the multiple participant filter.
 *
 * @param {string} senderValue
 * @param {boolean} isChecked
 * @param {Object} [options]
 */
export function toggleSender(senderValue, isChecked, options = {}) {
    if (senderValue === "") {
        // "All participants" was clicked
        applySenderFilter([], options);
        return;
    }

    const current = new Set(state.selectedSenders || []);
    if (isChecked) {
        current.add(senderValue);
    } else {
        current.delete(senderValue);
    }

    applySenderFilter(Array.from(current), options);
}

/**
 * Resets the sender filter to "All participants".
 *
 * @param {Object} [options]
 */
export function clearSenderFilter(options = {}) {
    applySenderFilter([], options);
}

/**
 * Opens or closes the sender filter dropdown popover.
 *
 * @param {boolean} [forceOpen]
 */
export function toggleSenderFilterDropdown(forceOpen) {
    const dropdown = $("sender-filter-dropdown");
    const btn = $("sender-filter-btn");
    if (!dropdown || !btn) return;

    const willOpen = typeof forceOpen === "boolean" ? forceOpen : dropdown.hidden;
    dropdown.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
        $("sender-filter-search")?.focus({ preventScroll: true });
    }
}

export function isSenderFilterDropdownOpen() {
    const dropdown = $("sender-filter-dropdown");
    return Boolean(dropdown && !dropdown.hidden);
}

export function closeSenderFilterDropdown() {
    toggleSenderFilterDropdown(false);
}

/**
 * Resets the sender filter control state and hides it.
 */
export function resetSenderFilterUI() {
    state.selectedSenders = [];
    closeSenderFilterDropdown();

    const listEl = $("sender-filter-list");
    const container = $("sender-filter-container");
    const summaryEl = $("sender-filter-summary");
    const searchEl = $("sender-filter-search");

    if (listEl) listEl.innerHTML = "";
    if (searchEl) searchEl.value = "";
    if ($("sender-filter-no-results")) $("sender-filter-no-results").hidden = true;
    if (summaryEl) setSenderFilterSummary(summaryEl, "All participants");
    syncSenderFilterClearButton();
    if (container) container.hidden = true;
}

/** Keeps the visible short label and the accessible button name in sync. */
function setSenderFilterSummary(summaryEl, summary) {
    summaryEl.textContent = summary;
    const container = $("sender-filter-container");
    container?.classList.toggle("has-filter", Boolean(state.selectedSenders?.length));
    const button = $("sender-filter-btn");
    if (button) {
        const label = `Filter by sender, ${summary}`;
        button.setAttribute("aria-label", label);
        button.title = label;
    }
}
