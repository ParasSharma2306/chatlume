/** Reads, validates, and writes Instagram viewer preferences in isolation. */
import { DEFAULT_IG_SETTINGS } from "./format.js?v=1.8.4";

export const IG_SETTINGS_KEY = "chatlume-instagram-settings";

export function sanitizeInstagramSettings(value = {}) {
    return {
        ...DEFAULT_IG_SETTINGS,
        timeFormat: ["12", "24"].includes(value.timeFormat) ? value.timeFormat : DEFAULT_IG_SETTINGS.timeFormat,
        showSeconds: Boolean(value.showSeconds),
        timeBrackets: ["none", "square", "round"].includes(value.timeBrackets) ? value.timeBrackets : "none",
        dateFormat: ["long", "dmy", "mdy", "ymd"].includes(value.dateFormat) ? value.dateFormat : "long",
        dateSeparator: ["/", "-", "."].includes(value.dateSeparator) ? value.dateSeparator : "/",
        dateBrackets: ["none", "square", "round"].includes(value.dateBrackets) ? value.dateBrackets : "none",
        showSenderNames: value.showSenderNames !== false,
        persistentStorage: Boolean(value.persistentStorage)
    };
}

export function readInstagramSettings(storage = null) {
    try {
        const target = storage || (typeof window !== "undefined" ? window.localStorage : null);
        return sanitizeInstagramSettings(JSON.parse(target?.getItem(IG_SETTINGS_KEY) || "{}"));
    } catch {
        return sanitizeInstagramSettings();
    }
}

export function writeInstagramSettings(settings, storage = null) {
    const clean = sanitizeInstagramSettings(settings);
    try {
        const target = storage || (typeof window !== "undefined" ? window.localStorage : null);
        target?.setItem(IG_SETTINGS_KEY, JSON.stringify(clean));
    } catch {}
    return clean;
}
