/** Finds the first message on a selected local calendar date. */
import { localDateBounds } from "./format.js?v=1.8.4";

export function findMessageIdForDate(messages, dateValue) {
    const bounds = localDateBounds(dateValue);
    if (!bounds) return "";
    return findMessageForDate(messages, bounds.start, bounds.end)?.id || "";
}

/** Exact date when present; otherwise the closest earlier message, like WhatsApp. */
export function findMessageForDate(messages, start, end) {
    const exact = messages.find((item) => item.type === "msg" && item.ts >= start && item.ts < end);
    if (exact) return { id: exact.id, exact: true };
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        if (item.type === "msg" && item.ts < start) return { id: item.id, exact: false };
    }
    return null;
}
