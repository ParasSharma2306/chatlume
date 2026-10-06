/** Pure helpers for selecting and searching conversations discovered in a ZIP. */
export function makeThreadOptions(threads, labelFor) {
    return threads
        .map((thread, index) => ({ index, label: labelFor(thread.folder), files: thread.files.length }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.index - b.index);
}

export function filterThreadOptions(options, query) {
    const needle = String(query || "").trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
}

/** Restores a saved thread, opens a sole thread automatically, or asks the UI. */
export function initialThreadSelection(threads, preferredFolder = "") {
    if (preferredFolder) return threads.find((thread) => thread.folder === preferredFolder) || null;
    return threads.length === 1 ? threads[0] : null;
}
