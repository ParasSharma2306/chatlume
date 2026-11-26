/**
 * ============================================================================
 * Conversation picker
 * ============================================================================
 * An Instagram export holds every DM thread. When there is more than one,
 * the sidebar lists them (sorted, filterable) and the session loads the one
 * the user taps.
 * ============================================================================
 */
import { $, escapeHtml } from "../shared/dom.js?v=1.9.0";
import { folderBoxLabel, folderLabel } from "./parser.js?v=1.9.0";
import { igState } from "./state.js?v=1.9.0";
import { isMobileLayout, setSidebarState } from "./ui.js?v=1.9.0";
import { filterThreadOptions, makeThreadOptions } from "./threads-model.js?v=1.9.0";
import { display } from "./anonymize.js?v=1.9.0";

/**
 * @param {Array}    threads   From parser.findThreads().
 * @param {Function} onSelect  Called with the chosen thread.
 */
export function showThreadSelector(threads, onSelect) {
    $("ig-upload-panel")?.classList.add("hidden");
    $("ig-chat-list-panel")?.classList.add("hidden");
    const panel = $("ig-thread-panel");
    const list = $("ig-thread-list");
    if (!panel || !list) return;
    panel.classList.remove("hidden");

    // Sort by folder label so a long export is scannable, and remember the
    // original index — selection indexes into igState.threads. Folder names are
    // people's names, so Anonymize mode lists them by position instead.
    const sorted = makeThreadOptions(threads, folderLabel);
    const entries = display.isOn()
        ? sorted.map((entry, position) => ({ ...entry, label: `Conversation ${position + 1}` }))
        : sorted;
    const hint = $("ig-thread-anon-hint");
    if (hint) hint.hidden = !display.isOn();

    const filterInput = $("ig-thread-filter");
    const countEl = $("ig-thread-count");
    const emptyEl = $("ig-thread-empty");

    function paint(query) {
        const needle = query.trim().toLowerCase();
        const visible = filterThreadOptions(entries, needle);

        list.innerHTML = visible.map((e) => `
    <button class="chat-item" type="button" data-thread-idx="${e.index}">
      <div class="chat-item-avatar" style="background:linear-gradient(135deg,#833AB4,#C13584,#E1306C)" aria-hidden="true">${escapeHtml(e.label.charAt(0).toUpperCase())}</div>
      <div class="chat-item-info">
        <h4>${escapeHtml(e.label)}</h4>
        <span>${folderBoxLabel(e.folder) || "Conversation"}${e.files > 1 ? ` · ${e.files} parts` : ""}</span>
      </div>
    </button>`).join("");

        if (countEl) {
            countEl.innerText = needle
                ? `${visible.length} of ${entries.length} conversations`
                : `${entries.length} conversation${entries.length === 1 ? "" : "s"} found`;
        }
        if (emptyEl) emptyEl.hidden = visible.length > 0;
    }

    if (filterInput) {
        filterInput.value = "";
        // Re-bound on every call, so replace the node to drop stale listeners.
        const fresh = filterInput.cloneNode(true);
        filterInput.replaceWith(fresh);
        fresh.addEventListener("input", () => paint(fresh.value));
    }

    paint("");

    // Delegated once — the selector can be reopened from the empty state.
    if (!list.dataset.bound) {
        list.dataset.bound = "1";
        list.addEventListener("click", async (event) => {
            const btn = event.target.closest("[data-thread-idx]");
            if (!btn) return;
            await onSelect(igState.threads[parseInt(btn.dataset.threadIdx, 10)]);
        });
    }

    syncBackButtons();
    if (isMobileLayout()) setSidebarState(true);
}

/** "Back to open chat" only makes sense while one is open. */
export function syncBackButtons() {
    document.querySelectorAll("[data-ig-back]").forEach((button) => { button.hidden = !igState.messageOnlyCount; });
}

/** Leaves the picker or import form for the conversation already on screen. */
export function showOpenThread() {
    if (!igState.messageOnlyCount) return;
    $("ig-upload-panel")?.classList.add("hidden");
    $("ig-thread-panel")?.classList.add("hidden");
    $("ig-chat-list-panel")?.classList.remove("hidden");
}
