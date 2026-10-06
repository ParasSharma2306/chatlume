/** Coordinates Instagram's date picker with the virtual message list. */
import { $ } from "../shared/dom.js?v=1.8.2";
import { pushOverlayState, popOverlayState } from "../shared/history.js?v=1.8.2";
import { findMessageForDate } from "./date-jump-model.js?v=1.8.2";
import { localDateBounds } from "./format.js?v=1.8.2";
import { igState } from "./state.js?v=1.8.2";
import { jumpToMessage } from "./search.js?v=1.8.2";
import { showToast } from "./ui.js?v=1.8.2";

export { findMessageForDate, findMessageIdForDate } from "./date-jump-model.js?v=1.8.2";

export function openDateSheet() {
    if (!igState.messageOnlyCount) { showToast("Load a conversation first", "warn"); return; }
    const sheet = $("ig-date-sheet");
    const input = $("ig-date-sheet-input");
    if (!sheet || !input) return;
    input.value = "";
    sheet.hidden = false;
    requestAnimationFrame(() => {
        sheet.classList.add("open");
        input.focus({ preventScroll: true });
    });
    pushOverlayState("ig-date-sheet");
}

export function closeDateSheet({ fromHistory = false } = {}) {
    const sheet = $("ig-date-sheet");
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("open");
    window.setTimeout(() => {
        if (!sheet.classList.contains("open")) sheet.hidden = true;
    }, 180);
    if (!fromHistory) popOverlayState();
}

export function applyDateJump() {
    const input = $("ig-date-sheet-input");
    if (!input?.value) return;
    const bounds = localDateBounds(input.value);
    const match = bounds ? findMessageForDate(igState.filteredMessages, bounds.start, bounds.end) : null;
    if (!match) {
        $("ig-date-sheet-error")?.removeAttribute("hidden");
        return;
    }
    $("ig-date-sheet-error")?.setAttribute("hidden", "");
    closeDateSheet();
    jumpToMessage(match.id);
    if (!match.exact) showToast("No messages on that date. Jumped to the closest previous message.", "info");
}
