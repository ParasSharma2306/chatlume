/** Display formatting for Instagram's epoch-millisecond timestamps. */
export const DEFAULT_IG_SETTINGS = Object.freeze({
    timeFormat: "12",
    showSeconds: false,
    timeBrackets: "none",
    dateFormat: "long",
    dateSeparator: "/",
    dateBrackets: "none",
    showSenderNames: true
});

export function formatMessageTime(timestamp, settings = DEFAULT_IG_SETTINGS) {
    const date = new Date(timestamp);
    const options = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: settings.timeFormat !== "24"
    };
    if (settings.showSeconds) options.second = "2-digit";
    let value = date.toLocaleTimeString(undefined, options);
    if (settings.timeBrackets === "square") value = `[${value}]`;
    if (settings.timeBrackets === "round") value = `(${value})`;
    return value;
}

export function formatDateLabel(timestamp, settings = DEFAULT_IG_SETTINGS) {
    const date = new Date(timestamp);
    let value;
    if (settings.dateFormat === "long") {
        value = date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    } else {
        const y = String(date.getFullYear()).padStart(4, "0");
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const sep = settings.dateSeparator || "/";
        if (settings.dateFormat === "mdy") value = [m, d, y].join(sep);
        else if (settings.dateFormat === "ymd") value = [y, m, d].join(sep);
        else value = [d, m, y].join(sep);
    }
    if (settings.dateBrackets === "square") value = `[${value}]`;
    if (settings.dateBrackets === "round") value = `(${value})`;
    return value;
}

/** Converts a local date-picker value to the first matching epoch timestamp. */
export function localDateBounds(dateValue) {
    const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const start = new Date(year, month - 1, day);
    if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
    const end = new Date(year, month - 1, day + 1);
    return { start: start.getTime(), end: end.getTime() };
}
