/**
 * ============================================================================
 * Time and date display
 * ============================================================================
 * How a message's timestamp and a day marker are shown, according to the
 * user's Settings (time format, seconds, brackets, date format/separator,
 * export date order and calendar). Parsing itself lives in
 * js/whatsapp-parser.js; this layer only decides what to print.
 * ============================================================================
 */
import {
    extractTimePart,
    hourOf,
    inferDateOrder as parserInferDateOrder,
    parseDateLabel,
    parseTimestamp,
    resolveDateOrder
} from "../whatsapp-parser.js?v=1.7.3";
import { state } from "./state.js?v=1.7.3";

/** Wraps `value` in the bracket style chosen in Settings. */
export function applyBrackets(value, bracketStyle) {
    if (bracketStyle === "square") return `[${value}]`;
    if (bracketStyle === "round") return `(${value})`;
    return value;
}

/** The time shown in a bubble's meta row. */
export function formatMessageTime(rawTime) {
    const timestamp = parseTimestamp(rawTime || "");
    if (!timestamp) {
        return applyBrackets(extractTimePart(rawTime || ""), state.settings.timeBrackets);
    }
    const parsed = timestamp.time;
    const original = parsed.raw;
    if (state.settings.timeFormat === "auto") {
        // Drop the seconds field only; the export's own digits, separator and
        // day-period marker are kept exactly as written.
        const autoTime = (parsed.second !== "" && !state.settings.showSeconds)
            ? original.replace(/^(\P{Nd}*\p{Nd}{1,2}[:.]\p{Nd}{2})[:.]\p{Nd}{2}/u, "$1")
            : original;
        return applyBrackets(autoTime.trim(), state.settings.timeBrackets);
    }

    const showSeconds = state.settings.showSeconds && parsed.second !== "";
    let hour = hourOf(parsed);
    let suffix = "";

    if (state.settings.timeFormat === "12") {
        suffix = hour >= 12 ? " PM" : " AM";
        hour = (hour % 12) || 12;
    }

    const hourText = state.settings.timeFormat === "24" ? String(hour).padStart(2, "0") : String(hour);
    const secondText = showSeconds ? `:${String(parsed.second).padStart(2, "0")}` : "";
    return applyBrackets(`${hourText}:${String(parsed.minute).padStart(2, "0")}${secondText}${suffix}`, state.settings.timeBrackets);
}

/** The text of a sticky day marker. Unparseable labels are shown as-is. */
export function formatDateLabel(label) {
    const raw = label || "";
    const parsed = parseExportDateLabel(raw);
    if (!parsed) {
        return applyBrackets(raw, state.settings.dateBrackets);
    }

    if (state.settings.dateFormat === "original") {
        return applyBrackets(formatOriginalDateSeparator(raw), state.settings.dateBrackets);
    }

    if (state.settings.dateFormat === "long") {
        return applyBrackets(
            parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            state.settings.dateBrackets
        );
    }

    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const year = String(parsed.getFullYear());
    const separator = state.settings.dateSeparator;
    const parts = {
        dmy: [day, month, year],
        mdy: [month, day, year],
        ymd: [year, month, day]
    }[state.settings.dateFormat] || [day, month, year];

    return applyBrackets(parts.join(separator), state.settings.dateBrackets);
}

/** "original" date format still honours the separator setting. */
function formatOriginalDateSeparator(label) {
    const parts = String(label || "").split(/[./-]/);
    if (parts.length !== 3) return label;
    return parts.join(state.settings.dateSeparator);
}

/**
 * The Date a date label stands for, read with the user's Export Date Order and
 * Calendar settings; "auto" falls back to the order inferred from the export
 * and to era markers / year ranges (see parseDateLabel). Returns null when the
 * label is not a valid date, in which case callers keep the original text.
 */
export function parseExportDateLabel(label) {
    return parseDateLabel(label, {
        order: resolveDateOrder(state.settings.dateOrder, state.inferredDateOrder),
        calendar: state.settings.calendar
    });
}

/** Infers day/month order from every date label in the export. */
export function inferDateOrder(dateLabels) {
    return parserInferDateOrder(dateLabels, {
        calendar: state.settings.calendar,
        tieBreak: getTieBreakDateOrder()
    });
}

/** Ambiguous exports (every day ≤ 12) follow the browser locale. */
function getTieBreakDateOrder() {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    return locale.toLowerCase().startsWith("en-us") ? "MDY" : "DMY";
}

/** Recomputes the inferred order from the loaded chat's date markers. */
export function reinferDateOrder() {
    state.inferredDateOrder = inferDateOrder(
        state.messages.filter((entry) => entry.type === "date").map((entry) => entry.content)
    );
}
