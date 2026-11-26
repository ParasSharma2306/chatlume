/**
 * ============================================================================
 * Instagram anonymize toggle
 * ============================================================================
 * Switches Anonymize mode on or off and repaints everything that shows a
 * name — header, sidebar, bubbles, reactions, filter, identity select,
 * analytics, saved exports, the thread picker, Wrapped and search results —
 * without reloading the conversation.
 * ============================================================================
 */
import { $ } from "../shared/dom.js?v=1.9.0";
import { getScrollAnchor, restoreScrollAnchor } from "../shared/virtual-list.js?v=1.9.0";
import { igState } from "./state.js?v=1.9.0";
import { display } from "./anonymize.js?v=1.9.0";
import { renderInstagramStoredImports } from "./persistence.js?v=1.9.0";
import { renderChatList } from "./render.js?v=1.9.0";
import { isSearchOpen, runSearch } from "./search.js?v=1.9.0";
import { populateInstagramSenderFilter, refreshThreadChrome, loadThread } from "./session.js?v=1.9.0";
import { showThreadSelector } from "./threads.js?v=1.9.0";
import { closeMenu, generateStats, showToast } from "./ui.js?v=1.9.0";
import { renderInstagramWrapped } from "./wrapped.js?v=1.9.0";

const listeners = new Set();

/** Lets late-bound views (gallery, reaction popover) repaint when the mode changes. */
export function onAnonymizeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Flips the mode (or sets it with `force`) and repaints in place. */
export function toggleAnonymize(force) {
    const on = typeof force === "boolean" ? force : !display.isOn();
    closeMenu();
    if (on === display.isOn()) {
        refreshThreadChrome();
        return;
    }
    display.setOn(on);
    refreshThreadChrome();
    renderInstagramStoredImports();
    if (!$("ig-thread-panel")?.classList.contains("hidden") && igState.threads.length) {
        showThreadSelector(igState.threads, loadThread);
    }

    if (igState.messageOnlyCount) {
        populateInstagramSenderFilter();
        generateStats();
        if ($("ig-wrapped-modal") && !$("ig-wrapped-modal").hidden) renderInstagramWrapped();
        if (isSearchOpen() && igState.searchQuery) {
            // Results are matched against what is on screen, so they change too.
            runSearch(igState.searchQuery);
        } else {
            const viewport = $("ig-viewport");
            const anchor = viewport ? getScrollAnchor(viewport) : null;
            renderChatList();
            if (viewport) restoreScrollAnchor(viewport, anchor);
        }
    }
    listeners.forEach((listener) => listener(on));
    showToast(on ? "Anonymize on: names, numbers and emails are hidden" : "Anonymize off: showing real names", "info");
}
