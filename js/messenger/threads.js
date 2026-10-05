/**
 * Messenger conversation selector. Thread discovery comes from archive paths,
 * never from an export index file.
 */
import { $, escapeHtml } from "../shared/dom.js?v=1.9.0-beta1";
import { folderLabel } from "./parser.js?v=1.9.0-beta1";
import { messengerState } from "./state.js?v=1.9.0-beta1";

export function showThreadSelector(threads, onSelect) {
    $("messenger-upload-panel")?.classList.add("hidden");
    $("messenger-loaded-panel")?.classList.add("hidden");
    const panel = $("messenger-thread-panel");
    const list = $("messenger-thread-list");
    if (!panel || !list) return;
    panel.classList.remove("hidden");
    const rows = threads.map((thread, index) => ({ thread, index, label: thread.title || folderLabel(thread.folder) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const paint = (query = "") => {
        const needle = query.trim().toLocaleLowerCase();
        const visible = rows.filter((row) => row.label.toLocaleLowerCase().includes(needle));
        list.innerHTML = visible.map(({ index, label, thread }) => `
            <button class="chat-item" type="button" data-thread-index="${index}">
                <div class="chat-item-avatar messenger-avatar" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase())}</div>
                <div class="chat-item-info"><h4>${escapeHtml(label)}</h4><span>${thread.files.length} message file${thread.files.length === 1 ? "" : "s"}</span></div>
            </button>`).join("");
        $("messenger-thread-count").textContent = `${visible.length} of ${rows.length} conversations`;
        $("messenger-thread-empty").hidden = visible.length > 0;
    };
    const filter = $("messenger-thread-filter");
    if (filter) {
        filter.value = "";
        const fresh = filter.cloneNode(true);
        filter.replaceWith(fresh);
        fresh.addEventListener("input", () => paint(fresh.value));
    }
    paint();
    if (!list.dataset.bound) {
        list.dataset.bound = "1";
        list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-thread-index]");
            if (button) onSelect(messengerState.threads[Number(button.dataset.threadIndex)]);
        });
    }
    if (window.innerWidth <= 800) {
        $("messenger-sidebar")?.classList.add("active");
        $("messenger-sidebar-backdrop")?.classList.add("active");
    }
}
