import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import { versioned } from "./versioned.mjs";

const { DEFAULT_SETTINGS } = await versioned("../js/settings.js");
const { state } = await versioned("../js/whatsapp/state.js");
const { applyBrackets, formatDateLabel, formatMessageTime } = await versioned("../js/whatsapp/format.js");

/**
 * Display formatting of times and day markers per Settings. Parsing is
 * covered in whatsapp-parser.test.mjs; this pins what gets printed.
 */

beforeEach(() => {
    state.settings = { ...DEFAULT_SETTINGS };
    state.inferredDateOrder = "DMY";
});

describe("whatsapp/format applyBrackets", () => {
    test("wraps per style", () => {
        assert.equal(applyBrackets("x", "none"), "x");
        assert.equal(applyBrackets("x", "square"), "[x]");
        assert.equal(applyBrackets("x", "round"), "(x)");
    });
});

describe("whatsapp/format formatMessageTime", () => {
    test("auto keeps the export's own time, minus seconds by default", () => {
        assert.equal(formatMessageTime("12/01/2024, 21:05:33"), "21:05");
        state.settings.showSeconds = true;
        assert.equal(formatMessageTime("12/01/2024, 21:05:33"), "21:05:33");
    });

    test("12h and 24h conversions", () => {
        state.settings.timeFormat = "12";
        assert.equal(formatMessageTime("12/01/2024, 21:05"), "9:05 PM");
        assert.equal(formatMessageTime("12/01/2024, 00:07"), "12:07 AM");
        state.settings.timeFormat = "24";
        assert.equal(formatMessageTime("12/01/2024, 9:05 PM"), "21:05");
    });

    test("brackets apply to the formatted time", () => {
        state.settings.timeBrackets = "square";
        assert.equal(formatMessageTime("12/01/2024, 21:05"), "[21:05]");
    });

    test("unparseable input is shown verbatim rather than dropped", () => {
        assert.equal(formatMessageTime("nonsense"), "nonsense");
        assert.equal(formatMessageTime(""), "");
    });
});

describe("whatsapp/format formatDateLabel", () => {
    test("original keeps the label but honours the separator", () => {
        assert.equal(formatDateLabel("12/01/2024"), "12/01/2024");
        state.settings.dateSeparator = "-";
        assert.equal(formatDateLabel("12/01/2024"), "12-01-2024");
    });

    test("explicit orders", () => {
        state.settings.dateFormat = "ymd";
        assert.equal(formatDateLabel("12/01/2024"), "2024/01/12");
        state.settings.dateFormat = "mdy";
        state.settings.dateSeparator = ".";
        assert.equal(formatDateLabel("12/01/2024"), "01.12.2024");
    });

    test("the export date order setting overrides inference", () => {
        state.settings.dateFormat = "ymd";
        state.settings.dateOrder = "mdy";
        assert.equal(formatDateLabel("12/01/2024"), "2024/12/01");
    });

    test("unparseable labels are shown verbatim, still bracketed", () => {
        state.settings.dateBrackets = "round";
        assert.equal(formatDateLabel("Yesterday"), "(Yesterday)");
    });
});
