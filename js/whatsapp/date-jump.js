/**
 * ============================================================================
 * Go to Date
 * ============================================================================
 * The date sheet in the header menu: pick a day and the list jumps to its
 * marker, or to the closest earlier one when that day has no messages.
 * ============================================================================
 */
import { $ } from "../shared/dom.js?v=1.6.2";
import { pushOverlayState, popOverlayState } from "../shared/history.js?v=1.6.2";
import { MAX_RENDERED_ITEMS, state } from "./state.js?v=1.6.2";
import { formatDateLabel, parseExportDateLabel } from "./format.js?v=1.6.2";
import { renderChatList } from "./render.js?v=1.6.2";
import { closeMenu, showToast } from "./ui.js?v=1.6.2";

export function handleDateJumpAction(event) {
    event.preventDefault();
    closeMenu();

    if (!state.messages.length) {
        showToast("Load a chat first", "warn");
        return;
    }

    openDateSheet();
}

export function openDateSheet() {
    const sheet = $("date-sheet");
    const input = $("date-sheet-input");
    if (!sheet || !input) return;

    input.value = "";
    sheet.hidden = false;
    requestAnimationFrame(() => {
        sheet.classList.add("open");
        input.focus({ preventScroll: true });
    });
    pushOverlayState("date-sheet");
}

export function closeDateSheet() {
    const sheet = $("date-sheet");
    if (!sheet) return;

    sheet.classList.remove("open");
    window.setTimeout(() => {
        if (!sheet.classList.contains("open")) {
            sheet.hidden = true;
        }
    }, 160);
}

/** Cancel button: close and pop the history entry the sheet pushed. */
export function cancelDateSheet() {
    closeDateSheet();
    popOverlayState();
}

export function applyDateSheetSelection() {
    const selectedDate = $("date-sheet-input")?.value || "";
    if (!selectedDate) {
        showToast("Select a date", "warn");
        return;
    }

    closeDateSheet();
    popOverlayState();
    handleDateSelection(selectedDate);
}

/**
 * Scrolls to the day marker for `dateValue` (YYYY-MM-DD). Falls back to the
 * closest earlier day; reports when every marker is later than the target.
 */
export function handleDateSelection(dateValue) {
    if (!dateValue || !state.messages.length) return;

    const targetDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(targetDate.getTime())) {
        showToast("Invalid date format", "error");
        return;
    }

    targetDate.setHours(0, 0, 0, 0);
    const targetMs = targetDate.getTime();
    let exactIndex = -1;
    let bestBeforeIndex = -1;
    let bestBeforeMs = -Infinity;
    let bestAfterIndex = -1;
    let bestAfterMs = Infinity;

    state.filteredMessages.forEach((entry, index) => {
        if (entry.type !== "date") return;
        const parsed = parseExportDateLabel(entry.content);
        if (!parsed) return;

        const time = parsed.getTime();
        if (time === targetMs && exactIndex === -1) {
            exactIndex = index;
        }
        if (time <= targetMs && time > bestBeforeMs) {
            bestBeforeMs = time;
            bestBeforeIndex = index;
        }
        if (time >= targetMs && time < bestAfterMs) {
            bestAfterMs = time;
            bestAfterIndex = index;
        }
    });

    const bestIndex = exactIndex !== -1 ? exactIndex : bestBeforeIndex;
    if (bestIndex === -1) {
        showToast(bestAfterIndex !== -1 ? "No messages on or before that date" : "No valid date markers found", "warn");
        return;
    }

    state.renderRange.start = Math.max(0, bestIndex);
    state.renderRange.end = Math.min(state.filteredMessages.length, bestIndex + MAX_RENDERED_ITEMS);
    renderChatList();

    window.setTimeout(() => {
        const targetEntry = state.filteredMessages[findFirstMessageIndexForDate(bestIndex) ?? bestIndex];
        $(targetEntry?.id)?.scrollIntoView({ block: "start", behavior: "auto" });
        const label = formatDateLabel(state.filteredMessages[bestIndex]?.rawDate || state.filteredMessages[bestIndex]?.content);
        showToast(exactIndex !== -1 ? `Jumped to ${label}` : `Closest previous date: ${label}`);
    }, 50);
}

/** Index of the first message under a day marker (the marker itself if none). */
function findFirstMessageIndexForDate(dateMarkerIndex) {
    for (let i = dateMarkerIndex + 1; i < state.filteredMessages.length; i += 1) {
        const entry = state.filteredMessages[i];
        if (entry.type === "date") return dateMarkerIndex;
        if (entry.type === "msg") return i;
    }
    return dateMarkerIndex;
}
