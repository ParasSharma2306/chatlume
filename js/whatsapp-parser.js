/**
 * ============================================================================
 * WhatsApp export parsing helpers
 * ============================================================================
 * Pure functions for recognising WhatsApp plain-text export lines and turning
 * their locale-specific timestamps into real dates. No DOM, no state — this
 * module is imported by the viewer and exercised directly by the Node test
 * suite (tests/whatsapp-parser.test.mjs).
 *
 * A message header is parsed in stages rather than with one grammar-sized
 * regex, so each locale quirk lives in exactly one place:
 *
 *   1. strip invisible bidi/formatting characters
 *   2. map localized digits (Persian, Arabic-Indic, Devanagari, …) to ASCII
 *      for matching — the original text is kept for display
 *   3. anchored numeric date  (`14/12/22`, `14.12.2022`, `2022-12-14`, `22. 12. 14`)
 *   4. optional calendar era from an explicit list  (`AP`, `BE`, `AH`, `AD`, `CE`)
 *   5. optional locale filler word from an explicit list  (`klo`, `г.`)
 *   6. separator, then the time — matched only in the text *after* the date,
 *      so a dotted date can never be mistaken for a dotted time
 *   7. optional day-period marker (AM/PM and localized equivalents)
 *   8. the remainder is split into sender/content exactly as before
 *
 * Calendar conversion (Solar Hijri, Buddhist) happens separately, when a date
 * label is turned into a Date, so the interpretation can follow user settings
 * without re-parsing the export.
 *
 * Known, deliberately unsupported shapes (the viewer reports "Unrecognised
 * date format" rather than guessing):
 *   - fr-CA times      "07 h 05 min 09 s"   no h:mm structure
 *   - vi-VN            time before the date
 *   - ja-JP + Japanese calendar   "R6/1/1"  era letter glued to the year
 *   - Islamic (AH) dates parse but are never converted (Umm al-Qura and the
 *     tabular calendar differ by a day; either guess could be wrong)
 *   - Thai two-digit Buddhist years ("14/12/65") are read as Gregorian in
 *     automatic mode — indistinguishable — and need Settings → Calendar → Buddhist
 * ============================================================================
 */

// ─── 1. Invisible characters ─────────────────────────────────────────────────

/**
 * Bidi controls and zero-width characters WhatsApp (and iOS) sprinkle through
 * exports. None of them are legitimate filename characters, and all of them
 * break string comparison while being invisible on screen.
 *
 *   U+200B zero width space         U+200E/U+200F LRM/RLM
 *   U+202A–U+202E embeddings/overrides
 *   U+2066–U+2069 isolates (FSI/PDI — recent iOS wraps RTL names in these)
 *   U+061C Arabic letter mark       U+FEFF BOM / zero width no-break space
 */
const INVISIBLE_RE = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g;

export function stripInvisible(value) {
    return String(value || "").replace(INVISIBLE_RE, "");
}

/** Line-level cleanup applied to every export line before matching. */
export function normalizeLine(line) {
    return stripInvisible(String(line || "").replace(/\r/g, ""));
}

// ─── 2. Localized digits ─────────────────────────────────────────────────────

// Zero code points of decimal digit blocks seen in WhatsApp exports. Each block
// is ten consecutive code points, so a digit's value is its offset from zero.
const DIGIT_ZEROS = [
    0x0660, // Arabic-Indic       ٠١٢٣٤٥٦٧٨٩   (ar-EG, ar-SA, …)
    0x06F0, // Extended Arabic    ۰۱۲۳۴۵۶۷۸۹   (fa-IR, ur-PK)
    0x0966, // Devanagari         ०१२३४५६७८९   (mr-IN, ne-NP)
    0x09E6, // Bengali            ০১২৩৪৫৬৭৮৯   (bn-BD)
    0x0A66, // Gurmukhi
    0x0AE6, // Gujarati
    0x0B66, // Oriya
    0x0BE6, // Tamil
    0x0C66, // Telugu
    0x0CE6, // Kannada
    0x0D66, // Malayalam
    0x0E50, // Thai              ๐๑๒๓๔๕๖๗๘๙
    0x1040  // Myanmar
];
const DIGIT_RE = new RegExp(`[${DIGIT_ZEROS.map((zero) => {
    const from = String.fromCodePoint(zero);
    const to = String.fromCodePoint(zero + 9);
    return `${from}-${to}`;
}).join("")}]`, "g");

/**
 * Replaces localized decimal digits with ASCII digits. Every mapped digit is a
 * single UTF-16 code unit, so the result has the same length as the input and
 * match offsets can be applied back to the original text.
 */
export function normalizeDigits(value) {
    return String(value || "").replace(DIGIT_RE, (digit) => {
        const code = digit.charCodeAt(0);
        for (const zero of DIGIT_ZEROS) {
            if (code >= zero && code <= zero + 9) return String(code - zero);
        }
        return digit;
    });
}

// ─── 3–7. Timestamp grammar ──────────────────────────────────────────────────

// Numeric date. The first alternative is exactly the pattern the viewer has
// always accepted; the second adds the "22. 12. 14" shape (ko-KR, hu-HU,
// sr-RS, hr-HR) where a space follows each dot.
const DATE_PATTERN = String.raw`\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}|\d{1,4}\.\s\d{1,2}\.\s\d{1,4}`;

/**
 * Calendar eras ICU prints between the date and the time when the device
 * calendar is not Gregorian. Case-sensitive and closed: ordinary words such as
 * "at" or "be" must never be read as an era, or continuation text like
 * "12/31/23 at 10:30 we: met" would become a message header.
 */
export const ERA_TOKENS = Object.freeze({
    AP: "persian",   // Solar Hijri (Persian calendar, en-US + Persian calendar on iOS)
    BE: "buddhist",  // Buddhist Era (Thai)
    AH: "islamic",   // Anno Hegirae — recognised so the line parses; not convertible (see calendarForLabel)
    AD: "gregorian",
    CE: "gregorian"
});
const ERA_PATTERN = Object.keys(ERA_TOKENS).join("|");

// Locale words that sit between date and time without being an era.
const FILLER_TOKENS = ["klo", "г\\."]; // fi-FI "klo" (= at), bg-BG "г." (= year)
const FILLER_PATTERN = FILLER_TOKENS.join("|");

// Day-period markers. ICU places some before the time (Korean, Chinese) and
// most after it. Closed lists again: anything else after the time belongs to
// the message.
const PREFIX_PERIODS = Object.freeze({
    "오전": "am", "오후": "pm",                       // ko-KR
    "上午": "am", "下午": "pm",                       // zh-CN, zh-HK
    "凌晨": "am", "清晨": "am", "早上": "am",         // zh-TW
    "中午": "pm", "晚上": "pm"
});
const SUFFIX_PERIODS = Object.freeze({
    "a.m.": "am", "p.m.": "pm",                     // en-CA, es-MX
    "a. m.": "am", "p. m.": "pm",                   // es-AR, es-CO
    "ص": "am", "م": "pm",                           // Arabic locales
    "π.μ.": "am", "μ.μ.": "pm",                     // el-GR
    "PG": "am", "PTG": "pm"                         // ms-MY
});
const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PREFIX_PERIOD_PATTERN = Object.keys(PREFIX_PERIODS).map(escapeForRegex).join("|");
// [APap][Mm] is the legacy AM/PM class (AM, am, Am, aM); the rest are additions.
const SUFFIX_PERIOD_PATTERN = ["[APap][Mm]", ...Object.keys(SUFFIX_PERIODS).map(escapeForRegex)].join("|");

// Stage 3–5: "[date][ era][ filler][,] " — everything up to where the time starts.
const DATE_HEAD_RE = new RegExp(
    `^\\[?(${DATE_PATTERN})(?:\\s+(${ERA_PATTERN}))?(?:\\s+(${FILLER_PATTERN}))?[,.\\u060C]?\\s+`,
    "u"
);
// Stage 6–7: the time, matched only against the text after the date head.
const TIME_RE = new RegExp(
    `^(?:(${PREFIX_PERIOD_PATTERN})\\s?)?(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?` +
    `(?:\\s?(${SUFFIX_PERIOD_PATTERN})(?![\\p{L}\\p{N}]))?`,   // marker must end at a boundary
    "u"
);
// Stage 8: closing bracket / dash, then the message remainder.
const TAIL_RE = /^\]?\s*(?:-\s*)?(.*)$/u;
const DATE_LABEL_RE = new RegExp(`^(${DATE_PATTERN})(?:\\s+(${ERA_PATTERN}))?$`, "u");
// Loose shape used only for diagnostics: an iOS-style bracketed date, or a
// date with something time-like after it. Never used to accept a line.
const TIMESTAMP_LIKE_RE = new RegExp(`^\\[(?:${DATE_PATTERN})[\\],\\s]|^(?:${DATE_PATTERN}).{0,24}\\d{1,2}[:.]\\d{2}`, "u");

/**
 * Matches a timestamp at the start of `line`. `line` must already be cleaned
 * (normalizeLine); `ascii` is its digit-normalised twin of identical length,
 * so offsets found on `ascii` slice `line`.
 *
 * Returns null or { timestamp, rawTime, restStart } where `restStart` is the
 * offset of the first character after the time (and any period marker).
 */
function matchTimestamp(line, ascii) {
    const head = ascii.match(DATE_HEAD_RE);
    if (!head) return null;
    const timeMatch = ascii.slice(head[0].length).match(TIME_RE);
    if (!timeMatch) return null;

    const [, date, era = "", filler = ""] = head;
    const [timeText, prefixPeriod = "", hour, minute, second = "", suffixPeriod = ""] = timeMatch;
    const dateStart = head[0].startsWith("[") ? 1 : 0;
    const dateEnd = dateStart + date.length;
    const eraEnd = era ? dateEnd + 1 + era.length : dateEnd;
    const timeStart = head[0].length;
    const timeEnd = timeStart + timeText.length;

    return {
        timestamp: {
            date: {
                raw: line.slice(dateStart, dateEnd),
                ascii: date,
                parts: date.split(/[/.\-]/).map((part) => part.trim())
            },
            era,
            filler,
            dateLabel: line.slice(dateStart, eraEnd),
            time: {
                raw: line.slice(timeStart, timeEnd),
                hour: parseInt(hour, 10),
                minute: parseInt(minute, 10),
                second,
                period: periodOf(prefixPeriod, suffixPeriod)
            }
        },
        rawTime: line.slice(dateStart, timeEnd),
        restStart: timeEnd
    };
}

function periodOf(prefix, suffix) {
    if (prefix) return PREFIX_PERIODS[prefix] || "";
    if (!suffix) return "";
    if (SUFFIX_PERIODS[suffix]) return SUFFIX_PERIODS[suffix];
    return /^[Aa]/.test(suffix) ? "am" : "pm";
}

/**
 * Parses a bare timestamp such as "14.12.2022, 12:55:37" or
 * "6/11/1405 AP, 7:41:05 AM" (the `rawTime` the viewer stores per message).
 * Returns null when the text is not exactly one timestamp.
 */
export function parseTimestamp(rawTime) {
    const line = normalizeLine(rawTime).trim();
    const found = matchTimestamp(line, normalizeDigits(line));
    if (!found || found.restStart !== line.length) return null;
    return found.timestamp;
}

/**
 * Recognises a WhatsApp export line that starts with a timestamp.
 *
 * Returns null for continuation lines, otherwise:
 *   { kind: "message", rawTime, sender, content, timestamp, line }
 *   { kind: "system",  rawTime, content, timestamp, line }
 *
 * `line` is the cleaned line (invisible characters removed) so callers can
 * reuse it for continuation handling without stripping twice.
 */
export function parseHeaderLine(originalLine) {
    const line = normalizeLine(originalLine);
    const found = matchTimestamp(line, normalizeDigits(line));
    if (!found) return null;

    const tail = line.slice(found.restStart).match(TAIL_RE);
    if (!tail) return null;
    const rest = tail[1];
    const base = { rawTime: found.rawTime, timestamp: found.timestamp, line };

    // Sender/content split, unchanged from the original viewer: the first
    // colon divides sender and text, but only when the sender is at most four
    // words — longer "senders" are system events whose text contains a colon.
    const messageMatch = rest.match(/^(.*?):\s*(.*)$/);
    if (messageMatch && messageMatch[1].trim().split(/\s+/).length <= 4) {
        return { kind: "message", sender: messageMatch[1].trim(), content: messageMatch[2] || "", ...base };
    }
    return { kind: "system", content: rest.trim(), ...base };
}

/** Diagnostics only: does this line start like a timestamp we failed to parse? */
export function looksLikeTimestampLine(line) {
    return TIMESTAMP_LIKE_RE.test(normalizeDigits(normalizeLine(line)));
}

/** "6/11/1405 AP" — the date label (with era) for a stored rawTime. */
export function extractDatePart(rawTime) {
    return parseTimestamp(rawTime)?.dateLabel || "";
}

/** "7:41:05 AM" — the time text (with any period marker) for a stored rawTime. */
export function extractTimePart(rawTime) {
    const parsed = parseTimestamp(rawTime);
    return parsed ? parsed.time.raw : String(rawTime || "");
}

/** 0–23 for a parsed time, honouring 12-hour markers. */
export function hourOf(time) {
    if (!time) return 0;
    let hour = time.hour;
    if (time.period === "pm" && hour < 12) hour += 12;
    if (time.period === "am" && hour === 12) hour = 0;
    return hour % 24;
}

// ─── Calendar conversion ─────────────────────────────────────────────────────

export const CALENDARS = ["auto", "gregorian", "persian", "buddhist"];
export const DATE_ORDERS = ["auto", "dmy", "mdy", "ymd"];

function normalizeGregorianYear(year) {
    if (year >= 100) return year;
    return year >= 70 ? year + 1900 : year + 2000;
}

function normalizePersianYear(year) {
    if (year >= 100) return year;
    return year >= 70 ? year + 1300 : year + 1400;
}

function normalizeBuddhistYear(year) {
    return year >= 100 ? year : year + 2500;
}

function createGregorianDateStrict(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
}

/**
 * Day number of a Solar Hijri date on a linear scale (arithmetic 33-year
 * cycle). Only differences of this value are used, which is what makes the
 * leap-year rule and the Gregorian conversion agree with each other.
 */
function persianDayNumber(year, month, day) {
    const jy = year + 1595;
    return -355668 + (365 * jy) + (Math.floor(jy / 33) * 8)
        + Math.floor(((jy % 33) + 3) / 4) + day
        + (month < 7 ? (month - 1) * 31 : ((month - 7) * 30) + 186);
}

export function isPersianLeapYear(year) {
    return persianDayNumber(year + 1, 1, 1) - persianDayNumber(year, 1, 1) === 366;
}

/** [gregorianYear, gregorianMonth, gregorianDay] for a valid Solar Hijri date. */
export function persianToGregorian(year, month, day) {
    let days = persianDayNumber(year, month, day);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
        gy += 100 * Math.floor(--days / 36524);
        days %= 36524;
        if (days >= 365) days += 1;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        gy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let gd = days + 1;
    const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
    const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 1;
    while (gm <= 12 && gd > monthDays[gm]) {
        gd -= monthDays[gm];
        gm += 1;
    }
    return [gy, gm, gd];
}

function createPersianDateStrict(year, month, day) {
    if (month < 1 || month > 12 || day < 1) return null;
    const maxDay = month <= 6 ? 31 : month <= 11 ? 30 : (isPersianLeapYear(year) ? 30 : 29);
    if (day > maxDay) return null;
    const [gy, gm, gd] = persianToGregorian(year, month, day);
    return createGregorianDateStrict(gy, gm, gd);
}

/**
 * Which calendar a date label should be read in.
 *
 * An explicit setting always wins. Otherwise an era token decides, and failing
 * that the year itself: WhatsApp did not exist before 2009, so a four-digit
 * year in 1300–1429 can only be Solar Hijri (1388 AP = 2009) and one in
 * 2500–2599 can only be Buddhist (2552 BE = 2009). Islamic years (1430 AH and
 * up) are reported as "islamic" so the caller refuses to convert them instead
 * of producing a date six centuries off. Two-digit Thai years are ambiguous
 * with Gregorian ones and are left to the setting.
 */
export function calendarForLabel({ era = "", yearRaw = "", calendar = "auto" } = {}) {
    if (calendar && calendar !== "auto") return calendar;
    if (era && ERA_TOKENS[era]) return ERA_TOKENS[era];
    if (yearRaw.length === 4) {
        const year = parseInt(yearRaw, 10);
        if (year >= 1300 && year <= 1429) return "persian";
        if (year >= 1430 && year <= 1499) return "islamic";
        if (year >= 2500 && year <= 2599) return "buddhist";
    }
    return "gregorian";
}

/**
 * Turns a date label ("14/12/22", "6/11/1405 AP", "۱۴۰۵/۶/۱۱") into a local
 * midnight Date, or null when the label is not a valid date in the given
 * order/calendar. `order` is "DMY" | "MDY" | "YMD"; `calendar` is one of
 * CALENDARS ("auto" resolves per label, see calendarForLabel).
 */
export function parseDateLabel(label, { order = "DMY", calendar = "auto" } = {}) {
    const match = normalizeDigits(stripInvisible(label).trim()).match(DATE_LABEL_RE);
    if (!match) return null;

    const [aRaw, bRaw, cRaw] = match[1].split(/[/.\-]/).map((part) => part.trim());
    const era = match[2] || "";
    const a = parseInt(aRaw, 10);
    const b = parseInt(bRaw, 10);
    const c = parseInt(cRaw, 10);
    if ([a, b, c].some(Number.isNaN)) return null;

    let year; let month; let day; let yearRaw;
    const normalizedOrder = String(order || "DMY").toUpperCase();
    if (normalizedOrder === "YMD") {
        if (aRaw.length !== 4) return null;
        [year, month, day, yearRaw] = [a, b, c, aRaw];
    } else if (normalizedOrder === "MDY") {
        [year, month, day, yearRaw] = [c, a, b, cRaw];
    } else {
        [year, month, day, yearRaw] = [c, b, a, cRaw];
    }

    switch (calendarForLabel({ era, yearRaw, calendar })) {
        case "persian":
            return createPersianDateStrict(normalizePersianYear(year), month, day);
        case "buddhist":
            return createGregorianDateStrict(normalizeBuddhistYear(year) - 543, month, day);
        case "islamic":
            // Recognised but not converted: iOS may use either the Umm al-Qura
            // or the tabular Islamic calendar and the two differ by a day, so
            // any conversion here would be a guess. Callers fall back to the
            // original label.
            return null;
        default:
            return createGregorianDateStrict(normalizeGregorianYear(year), month, day);
    }
}

// ─── Date order ──────────────────────────────────────────────────────────────

/** Explicit setting wins; "auto" (or anything unknown) uses the inferred order. */
export function resolveDateOrder(setting, inferred) {
    const value = String(setting || "auto").toUpperCase();
    return ["DMY", "MDY", "YMD"].includes(value) ? value : (inferred || "DMY");
}

function scoreDateOrder(labels, order, calendar) {
    let valid = 0;
    let invalid = 0;
    let monotonic = 0;
    let previousTime = null;

    labels.forEach((label) => {
        const date = parseDateLabel(label, { order, calendar });
        if (!date) {
            invalid += 1;
            return;
        }
        valid += 1;
        if (previousTime !== null) {
            monotonic += date.getTime() >= previousTime ? 1 : -1;
        }
        previousTime = date.getTime();
    });

    return (valid * 4) + (monotonic * 2) - (invalid * 6);
}

/**
 * Picks the day/month/year order that makes the most labels valid and
 * chronological. `tieBreak` is the order to prefer when nothing decides.
 */
export function inferDateOrder(dateLabels, { calendar = "auto", tieBreak = "DMY" } = {}) {
    const labels = (dateLabels || []).filter(Boolean);
    if (!labels.length) return tieBreak;

    let bestOrder = tieBreak;
    let bestScore = -Infinity;
    ["DMY", "MDY", "YMD"].forEach((order) => {
        const score = scoreDateOrder(labels, order, calendar);
        if (score > bestScore) {
            bestScore = score;
            bestOrder = order;
        }
    });
    return bestOrder;
}

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * Attachment references in message text: iOS `<attached: name>` tokens and
 * Android `name (file attached)` lines.
 */
export function extractAttachmentTokens(text) {
    const matches = [];
    const patterns = [
        /<attached:\s*([^>]+)>/gi,
        /\u200e?([^()\n]+?\.[a-z0-9]{2,5})\s+\((?:file attached|datei angehängt)\)/gi
    ];

    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.push({
                raw: match[0],
                fileName: match[1].trim()
            });
        }
    });

    return matches;
}

/**
 * Canonical form for matching an attachment reference against a ZIP entry.
 * Applied to both sides, so a name from the chat text (which iOS may wrap in
 * bidi isolates, and which may be NFC while the ZIP entry is NFD) meets the
 * ZIP entry on equal terms. Only invisible formatting characters are removed;
 * every visible character, including spaces and RTL letters, is kept.
 */
export function attachmentLookupKey(value) {
    return stripInvisible(String(value || "").normalize("NFC"))
        .trim()
        .replace(/^<attached:\s*/i, "")
        .replace(/>$/g, "")
        .replace(/\(file attached\)$/i, "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .toLowerCase();
}
