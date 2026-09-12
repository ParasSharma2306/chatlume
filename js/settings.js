/**
 * ============================================================================
 * Viewer settings schema
 * ============================================================================
 * The defaults and the validation applied to whatever is read back from
 * localStorage. Kept free of DOM access so the Node test suite can prove that
 * a saved settings object survives a reload and that unknown or invalid
 * values fall back to the defaults instead of leaking into the viewer.
 * ============================================================================
 */

export const DEFAULT_SETTINGS = Object.freeze({
    timeFormat: "auto",
    showSeconds: false,
    timeBrackets: "none",
    dateFormat: "original",
    dateSeparator: "/",
    dateBrackets: "none",
    // How the export's dates are *read* (as opposed to displayed). "auto"
    // keeps the detection every existing user already relies on; the explicit
    // values exist for exports where detection is ambiguous.
    dateOrder: "auto",
    calendar: "auto",
    showSenderNames: true,
    showReadTicks: true,
    richText: true,
    persistentStorage: false
});

export const SETTING_OPTIONS = Object.freeze({
    timeFormat: ["auto", "12", "24"],
    timeBrackets: ["none", "square", "round"],
    dateFormat: ["original", "dmy", "mdy", "ymd", "long"],
    dateSeparator: ["/", "-", "."],
    dateBrackets: ["none", "square", "round"],
    dateOrder: ["auto", "dmy", "mdy", "ymd"],
    calendar: ["auto", "gregorian", "persian", "buddhist"]
});

const BOOLEAN_SETTINGS = ["showSeconds", "showSenderNames", "showReadTicks", "richText", "persistentStorage"];

/** Fills gaps with defaults and rejects values outside the allowed lists. */
export function sanitizeSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...(value || {}) };

    Object.entries(SETTING_OPTIONS).forEach(([key, values]) => {
        if (!values.includes(settings[key])) {
            settings[key] = DEFAULT_SETTINGS[key];
        }
    });

    BOOLEAN_SETTINGS.forEach((key) => {
        settings[key] = Boolean(settings[key]);
    });

    return settings;
}
