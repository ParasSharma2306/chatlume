/**
 * Pure helpers for recognising WhatsApp plain-text export lines.
 *
 * Kept separate from the viewer so format changes can be regression-tested
 * without booting a browser or loading a multi-gigabyte export.
 */

const DATE_PATTERN = String.raw`\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}`;
// Recent iOS exports include a calendar-era marker (for example "AP" for the
// Persian calendar) between the numeric date and the comma.
const ERA_PATTERN = String.raw`(?:\s+[\p{L}\p{M}][\p{L}\p{M}.]{0,11})?`;
const TIME_PATTERN = String.raw`\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[APap][Mm])?`;
const TIMESTAMP_PATTERN = `${DATE_PATTERN}${ERA_PATTERN}[,.]?\\s+${TIME_PATTERN}`;

const MESSAGE_REGEX = new RegExp(
    `^\\[?(${TIMESTAMP_PATTERN})\\]?\\s*(?:-\\s*)?(.*?):\\s*(.*)$`,
    "u"
);
const SYSTEM_REGEX = new RegExp(
    `^\\[?(${TIMESTAMP_PATTERN})\\]?\\s*(?:-\\s*)?(.*)$`,
    "u"
);
const DATE_LABEL_REGEX = new RegExp(
    `^(${DATE_PATTERN})(?:\\s+([\\p{L}\\p{M}][\\p{L}\\p{M}.]{0,11}))?$`,
    "u"
);
const DATE_PART_REGEX = new RegExp(`^${DATE_PATTERN}${ERA_PATTERN}`, "u");

export function stripWhatsAppDirectionControls(value) {
    return String(value || "").replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\r]/g, "");
}

export function normalizeWhatsAppLine(line) {
    return stripWhatsAppDirectionControls(line);
}

export function parseWhatsAppLine(originalLine) {
    const line = normalizeWhatsAppLine(originalLine);
    const systemMatch = line.match(SYSTEM_REGEX);
    if (!systemMatch) return null;

    const messageMatch = line.match(MESSAGE_REGEX);
    // Keep the existing guard against system events containing a colon. It is
    // deliberately applied after timestamp recognition, not to continuation lines.
    if (messageMatch && messageMatch[2].trim().split(/\s+/).length <= 4) {
        return {
            type: "message",
            rawTime: messageMatch[1].trim(),
            sender: messageMatch[2].trim(),
            content: messageMatch[3] || "",
            line
        };
    }

    return {
        type: "system",
        rawTime: systemMatch[1].trim(),
        content: (systemMatch[2] || "").trim(),
        line
    };
}

export function extractWhatsAppDatePart(rawTime) {
    return String(rawTime || "").match(DATE_PART_REGEX)?.[0] || "";
}

export function extractWhatsAppTimePart(rawTime) {
    return String(rawTime || "").match(/\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s?(?:[APap][Mm])?/)?.[0] || String(rawTime || "");
}

export function parseWhatsAppDateLabel(label, order) {
    const match = String(label || "").trim().match(DATE_LABEL_REGEX);
    if (!match) return null;

    const parts = match[1].split(/[./-]/);
    const [aRaw, bRaw, cRaw] = parts;
    const a = parseInt(aRaw, 10);
    const b = parseInt(bRaw, 10);
    const c = parseInt(cRaw, 10);
    const era = (match[2] || "").replace(/\./g, "").toUpperCase();

    if ([a, b, c].some(Number.isNaN)) return null;

    let year;
    let month;
    let day;
    if (order === "YMD") {
        if (aRaw.length !== 4) return null;
        [year, month, day] = [a, b, c];
    } else if (order === "MDY") {
        [year, month, day] = [c, a, b];
    } else {
        [year, month, day] = [c, b, a];
    }

    if (era === "AP") {
        return createPersianDateStrict(year, month, day);
    }
    return createGregorianDateStrict(normalizeYear(year), month, day);
}

function normalizeYear(year) {
    if (year >= 100) return year;
    return year >= 70 ? year + 1900 : year + 2000;
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

function createPersianDateStrict(year, month, day) {
    const maxDay = month >= 1 && month <= 6 ? 31 : month <= 11 ? 30 : month === 12 ? 30 : 0;
    if (!maxDay || day < 1 || day > maxDay) return null;

    const [gregorianYear, gregorianMonth, gregorianDay] = persianToGregorian(year, month, day);
    return createGregorianDateStrict(gregorianYear, gregorianMonth, gregorianDay);
}

// Arithmetic Solar Hijri conversion. This lets date search and non-original
// display formats operate on real Gregorian dates for exports marked "AP".
function persianToGregorian(year, month, day) {
    let jy = year + 1595;
    let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8)
        + Math.floor(((jy % 33) + 3) / 4) + day
        + (month < 7 ? (month - 1) * 31 : ((month - 7) * 30) + 186);

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
