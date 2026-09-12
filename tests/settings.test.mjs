import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_SETTINGS, SETTING_OPTIONS, sanitizeSettings } from "../js/settings.js";
import { parseDateLabel, resolveDateOrder } from "../js/whatsapp-parser.js";

/**
 * What a v1.6.0 user has in localStorage: every key that existed then, and
 * nothing that was added since. Must load into v1.6.1 without changing what
 * they see.
 */
const V160_SAVED_SETTINGS = {
    timeFormat: "24",
    showSeconds: true,
    timeBrackets: "square",
    dateFormat: "long",
    dateSeparator: "-",
    dateBrackets: "round",
    showSenderNames: false,
    showReadTicks: true,
    richText: false,
    persistentStorage: true
};

describe("settings schema", () => {
    test("defaults keep automatic detection on", () => {
        assert.equal(DEFAULT_SETTINGS.dateOrder, "auto");
        assert.equal(DEFAULT_SETTINGS.calendar, "auto");
        assert.equal(DEFAULT_SETTINGS.timeFormat, "auto");
        assert.equal(DEFAULT_SETTINGS.dateFormat, "original");
    });

    test("no saved settings → defaults", () => {
        assert.deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS });
        assert.deepEqual(sanitizeSettings({}), { ...DEFAULT_SETTINGS });
        assert.deepEqual(sanitizeSettings(undefined), { ...DEFAULT_SETTINGS });
    });

    test("existing users keep every v1.6.0 preference and get automatic detection for the new ones", () => {
        const loaded = sanitizeSettings(V160_SAVED_SETTINGS);
        for (const [key, value] of Object.entries(V160_SAVED_SETTINGS)) {
            assert.equal(loaded[key], value, key);
        }
        assert.equal(loaded.dateOrder, "auto");
        assert.equal(loaded.calendar, "auto");
    });

    test("every explicit override is accepted", () => {
        for (const [key, values] of Object.entries(SETTING_OPTIONS)) {
            for (const value of values) {
                assert.equal(sanitizeSettings({ [key]: value })[key], value, `${key}=${value}`);
            }
        }
    });

    test("invalid or unknown values fall back to the default", () => {
        assert.equal(sanitizeSettings({ dateOrder: "yolo" }).dateOrder, "auto");
        assert.equal(sanitizeSettings({ calendar: "islamic" }).calendar, "auto");   // not offered: never convertible
        assert.equal(sanitizeSettings({ calendar: "AP" }).calendar, "auto");
        assert.equal(sanitizeSettings({ timeFormat: 12 }).timeFormat, "auto");     // wrong type
        assert.equal(sanitizeSettings({ dateFormat: null }).dateFormat, "original");
    });

    test("booleans are coerced", () => {
        const loaded = sanitizeSettings({ showSeconds: "yes", richText: 0, persistentStorage: undefined });
        assert.equal(loaded.showSeconds, true);
        assert.equal(loaded.richText, false);
        assert.equal(loaded.persistentStorage, false);
    });

    test("unknown keys are carried but never override known ones", () => {
        const loaded = sanitizeSettings({ future: 1, calendar: "persian" });
        assert.equal(loaded.calendar, "persian");
        assert.equal(loaded.future, 1);
    });

    test("settings survive the JSON round trip the viewer uses for localStorage", () => {
        const chosen = sanitizeSettings({ ...V160_SAVED_SETTINGS, dateOrder: "mdy", calendar: "persian" });
        const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(chosen)));
        assert.deepEqual(reloaded, chosen);
        assert.equal(reloaded.dateOrder, "mdy");
        assert.equal(reloaded.calendar, "persian");
    });
});

describe("settings drive date interpretation", () => {
    // The viewer resolves the order with resolveDateOrder(setting, inferred)
    // and reads labels with parseDateLabel(label, { order, calendar }). The
    // stored labels never change; only their interpretation does.
    const label = "6/11/1405 AP";
    const inferred = "MDY";

    function readWith(settings) {
        const order = resolveDateOrder(settings.dateOrder, inferred);
        return parseDateLabel(label, { order, calendar: settings.calendar });
    }

    test("automatic: inferred order + era marker", () => {
        assert.equal(readWith(sanitizeSettings({})).toDateString(), "Wed Sep 02 2026");
    });

    test("explicit date order overrides the inferred one", () => {
        // 6 Bahman 1405 (day 6, month 11)
        assert.equal(readWith(sanitizeSettings({ dateOrder: "dmy" })).toDateString(), "Tue Jan 26 2027");
        assert.equal(readWith(sanitizeSettings({ dateOrder: "mdy" })).toDateString(), "Wed Sep 02 2026");
        assert.equal(readWith(sanitizeSettings({ dateOrder: "ymd" })), null); // "6" is not a four-digit year
    });

    test("explicit calendar overrides the era marker", () => {
        assert.equal(readWith(sanitizeSettings({ calendar: "gregorian" })).getFullYear(), 1405);
        assert.equal(readWith(sanitizeSettings({ calendar: "persian" })).toDateString(), "Wed Sep 02 2026");
        assert.equal(readWith(sanitizeSettings({ calendar: "buddhist" })).getFullYear(), 1405 - 543);
    });

    test("automatic mode reads an ordinary export exactly as v1.6.0 did", () => {
        const settings = sanitizeSettings(V160_SAVED_SETTINGS);
        const date = parseDateLabel("14/12/22", { order: resolveDateOrder(settings.dateOrder, "DMY"), calendar: settings.calendar });
        assert.equal(date.toDateString(), "Wed Dec 14 2022");
    });
});
