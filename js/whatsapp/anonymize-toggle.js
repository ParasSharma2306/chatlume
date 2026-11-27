/**
 * ============================================================================
 * WhatsApp anonymize toggle
 * ============================================================================
 * Switches Anonymize mode on or off and repaints everything that shows a
 * name — header, sidebar, bubbles, filter, identity select, analytics,
 * stored chats, Wrapped, search results — without reloading the chat.
 * ============================================================================
 */
import { $ } from "../shared/dom.js?v=1.10.0";
import { getScrollAnchor, restoreScrollAnchor } from "../shared/virtual-list.js?v=1.10.0";
import { state } from "./state.js?v=1.10.0";
import { display } from "./anonymize.js?v=1.10.0";
import { populateSenderFilter } from "./filter.js?v=1.10.0";
import { refreshStorageSettingsUI, renderStoredImports } from "./persistence.js?v=1.10.0";
import { renderChatList } from "./render.js?v=1.10.0";
import { handleSearch } from "./search.js?v=1.10.0";
import { refreshChatChrome } from "./session.js?v=1.10.0";
import { generateStats } from "./stats.js?v=1.10.0";
import { closeMenu, showToast } from "./ui.js?v=1.10.0";
import { populateWrappedGraphic } from "./wrapped.js?v=1.10.0";

const listeners = new Set();

/** Lets late-bound views (the media gallery) repaint when the mode changes. */
export function onAnonymizeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Flips the mode (or sets it with `force`) and repaints in place. */
export function toggleAnonymize(force) {
    const on = typeof force === "boolean" ? force : !display.isOn();
    closeMenu();
    if (on === display.isOn()) {
        refreshChatChrome();
        return;
    }
    display.setOn(on);
    refreshChatChrome();
    renderStoredImports();
    refreshStorageSettingsUI();

    if (state.messageOnlyCount) {
        populateSenderFilter();
        generateStats();
        if ($("wrapped-modal") && !$("wrapped-modal").hidden) populateWrappedGraphic();
        const query = $("live-search")?.value.trim();
        if (state.isSearchOpen && query) {
            // Results are matched against what is on screen, so they change too.
            handleSearch(query);
        } else {
            const viewport = $("viewport");
            const anchor = viewport ? getScrollAnchor(viewport) : null;
            renderChatList();
            if (viewport) restoreScrollAnchor(viewport, anchor);
        }
    }
    listeners.forEach((listener) => listener(on));
    showToast(on ? "Anonymize on: names, numbers and emails are hidden" : "Anonymize off: showing real names", "info");
}
