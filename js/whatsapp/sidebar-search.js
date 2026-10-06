/** Pure filtering rule for the chat rows shown in the WhatsApp sidebar. */
export function filterSidebarChatEntries(entries, query) {
    const normalized = String(query || "").trim().toLowerCase();
    return entries.map((entry) => ({
        ...entry,
        visible: !normalized || `${entry.title || ""} ${entry.detail || ""}`.toLowerCase().includes(normalized)
    }));
}

/** Applies the sidebar chat filter to the active chat and saved chat rows. */
export function filterSidebarChats(query, panel = document.querySelector("#chat-list-panel")) {
    if (!panel) return;

    const rows = [];
    const active = panel.querySelector("#chat-list-item");
    if (active) {
        rows.push({
            element: active,
            title: active.querySelector("h4")?.textContent || "",
            detail: active.querySelector("span")?.textContent || ""
        });
    }
    panel.querySelectorAll(".stored-item").forEach((row) => {
        const button = row.querySelector(".chat-item");
        rows.push({
            element: row,
            title: button?.querySelector("h4")?.textContent || "",
            detail: button?.querySelector("span")?.textContent || ""
        });
    });

    const filtered = filterSidebarChatEntries(rows, query);
    for (const row of filtered) row.element.classList.toggle("search-hidden", !row.visible);

    const heading = panel.querySelector("[data-stored-list] .stored-list-head");
    if (heading) {
        heading.classList.toggle("search-hidden", !filtered.some((row) => row.element !== active && row.visible));
    }
}
