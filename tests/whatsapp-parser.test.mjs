import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    attachmentLookupKey,
    calendarForLabel,
    extractAttachmentTokens,
    extractDatePart,
    extractTimePart,
    hourOf,
    inferDateOrder,
    isPersianLeapYear,
    looksLikeTimestampLine,
    normalizeDigits,
    parseDateLabel,
    parseHeaderLine,
    parseTimestamp,
    persianToGregorian,
    resolveDateOrder,
    stripInvisible
} from "../js/whatsapp-parser.js";

// ─── Legacy oracle ───────────────────────────────────────────────────────────
// The exact regexes and split logic ChatLume used through v1.6.0. Every line in
// LEGACY_CORPUS must classify identically under the new parser; anything the
// new parser deliberately does differently is listed under INTENTIONAL_FIXES
// with the old (wrong) result spelled out.

const LEGACY_MESSAGE = /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[,.]?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?(.*?):\s*(.*)$/;
const LEGACY_SYSTEM = /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[,.]?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?(.*)$/;
const LEGACY_TIME = /\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?/;
const LEGACY_DATE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/;

function legacyParse(originalLine) {
    const line = originalLine.replace(/[\u200e\u200f\u202a-\u202e\u200b\r]/g, "");
    const systemMatch = line.match(LEGACY_SYSTEM);
    const messageMatch = systemMatch ? line.match(LEGACY_MESSAGE) : null;
    if (messageMatch && messageMatch[2].trim().split(/\s+/).length <= 4) {
        const rawTime = messageMatch[1].trim();
        return { kind: "message", rawTime, sender: messageMatch[2].trim(), content: messageMatch[3] || "",
            date: rawTime.match(LEGACY_DATE)?.[0] || "", time: rawTime.match(LEGACY_TIME)?.[0] || rawTime };
    }
    if (systemMatch) {
        const rawTime = systemMatch[1].trim();
        return { kind: "system", rawTime, content: (systemMatch[2] || "").trim(),
            date: rawTime.match(LEGACY_DATE)?.[0] || "", time: rawTime.match(LEGACY_TIME)?.[0] || rawTime };
    }
    return null;
}

function newParse(line) {
    const header = parseHeaderLine(line);
    if (!header) return null;
    const out = { kind: header.kind, rawTime: header.rawTime, content: header.content,
        date: extractDatePart(header.rawTime), time: extractTimePart(header.rawTime) };
    if (header.kind === "message") out.sender = header.sender;
    return out;
}

const LEGACY_CORPUS = [
    // Android
    "12/14/22, 7:05 AM - Alex: Hi",                                   // US
    "12/14/22, 7:05 PM - Alex: Hi",
    "14/12/2022, 19:05 - Alex: Hi",                                   // UK
    "14/12/22, 19:05 - Alex: Hi",
    "14.12.22, 07:05 - Alex: Hallo",                                  // DE
    "14.12.2022, 07:05 - Alex: Hallo",                                // RU / NO / PL
    "14-12-2022, 07:05 - Alex: Hoi",                                  // NL
    "2022-12-14, 07:05 - Alex: Hej",                                  // SE / LT
    "14/12/2022 07:05 - Alex: Salut",                                 // FR (no comma)
    "1/1/24, 10:00 am - Alex: yes",                                   // lowercase am
    "1/1/24, 10:00 - Alex Jo Smith Q: four word sender",
    "1/1/24, 10:00 - Alex: text with a colon: inside",
    "1/1/24, 10:00 - Alex: IMG-20240101-WA0001.jpg (file attached)",
    "1/1/24, 10:00 - Messages and calls are end-to-end encrypted.",  // system, no colon
    "1/1/24, 10:00 - Alex changed the subject from \"a: b\" to \"c\"", // system, colon, long sender
    "1/1/24, 10:00 - Alex added Bob",
    // iOS
    "[12/14/22, 7:05:09 AM] Alex: Hi",                               // US
    "[12/14/22, 7:05:09\u202fPM] Alex: Hi",                          // US, NNBSP before PM
    "[14/12/2022, 19:05:09] Alex: Hi",                               // UK
    "[14/12/2022 19:05:09] Alex: Hi",                                // no comma
    "[14.12.22, 19:05:09] Alex: Hallo",                              // DE
    "[2022/12/14, 19:05:09] Alex: Hi",                               // YMD
    "\u200e[1/1/24, 10:00:00 AM] Alex: \u200e<attached: 00000001-PHOTO-2024-01-01-10-00-00.jpg>",
    "[1/1/24, 10:00:00 AM] Alex: image omitted",
    "[1/1/24, 10:00 AM] Alex joined using this group's invite link", // system, no seconds
    "[1/1/24, 10:00:00] Alex: hi",
    "[1/1/24, 1:00:00] Alex: single-digit hour",
    "1/1/24, 1:00 - Alex: single-digit hour",
    // Not headers
    "just a continuation line",
    "12/31/23 Happy new year: yes",
    "http://x.com/1/2/3, 10:00 - a: b",
    "",
    "   "
];

describe("legacy compatibility", () => {
    for (const line of LEGACY_CORPUS) {
        test(`classifies exactly as v1.6.0 did: ${JSON.stringify(line)}`, () => {
            assert.deepEqual(newParse(line), legacyParse(line));
        });
    }

    test("legacy corpus actually exercises both kinds and continuation lines", () => {
        const kinds = new Set(LEGACY_CORPUS.map((line) => legacyParse(line)?.kind ?? "continuation"));
        assert.deepEqual([...kinds].sort(), ["continuation", "message", "system"]);
    });
});

describe("intentional differences from v1.6.0", () => {
    test("iOS system lines with seconds are system messages, not empty-sender messages", () => {
        const line = "[1/1/24, 10:00:05] Messages and calls are end-to-end encrypted.";
        // The old regex backtracked into the seconds field to find a colon.
        assert.deepEqual(legacyParse(line), {
            kind: "message", rawTime: "1/1/24, 10:00", sender: "", content: "05] Messages and calls are end-to-end encrypted.",
            date: "1/1/24", time: "10:00"
        });
        assert.deepEqual(newParse(line), {
            kind: "system", rawTime: "1/1/24, 10:00:05", content: "Messages and calls are end-to-end encrypted.",
            date: "1/1/24", time: "10:00:05"
        });
    });

    test("es-AR/es-MX/en-CA/el-GR day-period markers belong to the time, not the sender", () => {
        const line = "14/12/22, 7:05 p. m. - Alex: Hi";
        assert.equal(legacyParse(line).sender, "p. m. - Alex");
        const parsed = newParse(line);
        assert.equal(parsed.sender, "Alex");
        assert.equal(parsed.time, "7:05 p. m.");
        assert.equal(hourOf(parseTimestamp(parsed.rawTime).time), 19);
    });
});

// ─── New formats ─────────────────────────────────────────────────────────────

describe("locale timestamp formats", () => {
    const cases = [
        // [line, kind, date label, time text, hour24, sender]
        ["6/11/2025, 7:41:05 AM - Alex: Hi", "message", "6/11/2025", "7:41:05 AM", 7, "Alex"],
        ["[6/11/2025, 7:41:05\u202fAM] Alex: Hi", "message", "6/11/2025", "7:41:05\u202fAM", 7, "Alex"],
        ["\u200e[6/11/1405 AP, 7:41:05\u202fAM] Nami PSG: سلام", "message", "6/11/1405 AP", "7:41:05\u202fAM", 7, "Nami PSG"],
        ["[14/12/2022, 12.55.37] Alex: Hello", "message", "14/12/2022", "12.55.37", 12, "Alex"],        // en-DK
        ["[14.12.2022, 12.55.37] Alex: Hello", "message", "14.12.2022", "12.55.37", 12, "Alex"],        // da-DK
        ["[14.12.2022, 12:55:37] Alex: Hello", "message", "14.12.2022", "12:55:37", 12, "Alex"],        // nb-NO
        ["[2022/12/14, 12:55:37] Alex: Hello", "message", "2022/12/14", "12:55:37", 12, "Alex"],        // YMD
        ["14/12/22, 19.05 - Alex: Hi", "message", "14/12/22", "19.05", 19, "Alex"],                     // id-ID
        ["14.12.2022 klo 7.05.09 - Matti: Moi", "message", "14.12.2022", "7.05.09", 7, "Matti"],       // fi-FI
        ["14.12.22 г., 7:05:09 - Иван: Здравей", "message", "14.12.22", "7:05:09", 7, "Иван"],          // bg-BG
        ["[14/12/2565 BE, 12:55:37] Alex: Hi", "message", "14/12/2565 BE", "12:55:37", 12, "Alex"],    // buddhist
        ["[3/21/1448 AH, 7:05:09 PM] Alex: Hi", "message", "3/21/1448 AH", "7:05:09 PM", 19, "Alex"],  // islamic
        ["[14/12/2022, 7:05:09 a.m.] Alex: Hi", "message", "14/12/2022", "7:05:09 a.m.", 7, "Alex"],   // en-CA
        ["14/12/22, 7:05 p.m. - Alex: Hi", "message", "14/12/22", "7:05 p.m.", 19, "Alex"],            // es-MX
        ["14/12/22, 7:05 μ.μ. - Alex: Hi", "message", "14/12/22", "7:05 μ.μ.", 19, "Alex"],            // el-GR
        ["14/12/22, 7:05 PTG - Alex: Hi", "message", "14/12/22", "7:05 PTG", 19, "Alex"],              // ms-MY
        ["22. 12. 14. 오전 7:05:09 - 김: 안녕", "message", "22. 12. 14", "오전 7:05:09", 7, "김"],        // ko-KR
        ["22. 12. 14. 오후 7:05 - 김: 안녕", "message", "22. 12. 14", "오후 7:05", 19, "김"],
        ["[2022/12/14 上午7:05:09] 王: 你好", "message", "2022/12/14", "上午7:05:09", 7, "王"],           // zh-HK
        ["[2022/12/14 晚上7:05:09] 王: 你好", "message", "2022/12/14", "晚上7:05:09", 19, "王"],          // zh-TW
        ["2022. 12. 14. 7:05:09 - Anna: Szia", "message", "2022. 12. 14", "7:05:09", 7, "Anna"],       // hu-HU
        ["14. 12. 2022. 07:05:09 - Ana: Zdravo", "message", "14. 12. 2022", "07:05:09", 7, "Ana"],     // sr-RS
        ["[14/12/22, 12:00 AM] Alex: midnight", "message", "14/12/22", "12:00 AM", 0, "Alex"],
        ["[14/12/22, 12:00 PM] Alex: noon", "message", "14/12/22", "12:00 PM", 12, "Alex"],
        ["[14/12/22, 12:00:05] Alex joined", "system", "14/12/22", "12:00:05", 12, undefined]
    ];

    for (const [line, kind, date, time, hour, sender] of cases) {
        test(JSON.stringify(line), () => {
            const header = parseHeaderLine(line);
            assert.ok(header, "expected a header");
            assert.equal(header.kind, kind);
            assert.equal(header.timestamp.dateLabel, date);
            assert.equal(header.timestamp.time.raw, time);
            assert.equal(hourOf(header.timestamp.time), hour);
            assert.equal(header.sender, sender);
            // rawTime must round-trip through the standalone timestamp parser,
            // which is what the viewer uses for display and statistics.
            const reparsed = parseTimestamp(header.rawTime);
            assert.ok(reparsed, "rawTime should reparse");
            assert.equal(reparsed.dateLabel, date);
            assert.equal(reparsed.time.raw, time);
        });
    }
});

describe("dotted-date regression (PR #7 bug)", () => {
    // PR #7 widened time extraction to [:.] without anchoring it after the
    // date, so the date itself matched as the time. These must never regress.
    const cases = [
        ["14.12.2022, 12:55:37", "14.12.2022", "12:55:37", 12],
        ["14.12.22, 12:55", "14.12.22", "12:55", 12],
        ["14.12.2022, 12.55.37", "14.12.2022", "12.55.37", 12],
        ["14.12.22, 7:05", "14.12.22", "7:05", 7],
        ["14.12.2022 klo 19.05", "14.12.2022", "19.05", 19],
        ["14. 12. 2022. 07:05:09", "14. 12. 2022", "07:05:09", 7]
    ];
    for (const [rawTime, date, time, hour] of cases) {
        test(`${rawTime} → date ${date}, time ${time}`, () => {
            assert.equal(extractDatePart(rawTime), date);
            assert.equal(extractTimePart(rawTime), time);
            assert.equal(hourOf(parseTimestamp(rawTime).time), hour);
        });
    }
    test("German export end to end", () => {
        const header = parseHeaderLine("14.12.22, 12:55 - Alex: Hallo");
        assert.equal(header.timestamp.dateLabel, "14.12.22");
        assert.equal(header.timestamp.time.raw, "12:55");
        assert.equal(hourOf(header.timestamp.time), 12);
    });
});

describe("false-positive protection", () => {
    const notHeaders = [
        "12/31/23 at 10:30 we: met",             // "at" is not an era
        "12/31/23 be 10:30 we: met",             // lowercase "be" is not BE
        "12/31/23 AP1 10:30 we: met",            // era must be the whole token
        "12/31/23 Monday, 10:30 - x: y",         // weekday is not an era or filler
        "12/31/23 kl 10:30 - x: y",              // only the exact filler words
        "On 12/31/23, 10:30 - Alex: hi",         // must start with the date
        "1.5 million: that's a lot",
        "10:30 - Alex: time first",
        "Alex: 12/31/23, 10:30 - hi"
    ];
    for (const line of notHeaders) {
        test(`not a header: ${JSON.stringify(line)}`, () => {
            assert.equal(parseHeaderLine(line), null);
        });
    }
    test("message bodies containing dates and times stay in the body", () => {
        const header = parseHeaderLine("14/12/22, 7:05 - Alex: see you 15/12/22, 10:30 - or 16.12.22 at 9.15");
        assert.equal(header.kind, "message");
        assert.equal(header.content, "see you 15/12/22, 10:30 - or 16.12.22 at 9.15");
        assert.equal(header.timestamp.time.raw, "7:05");
    });
    test("day-period markers must end at a boundary", () => {
        // "PMAlex" is not "PM" followed by a sender
        assert.equal(parseHeaderLine("[1/1/24, 10:00 PMAlex: hi]")?.timestamp.time.period ?? "", "");
        // Arabic PM marker followed by a dash is a marker; an Arabic sender starting with م is not
        assert.equal(parseHeaderLine("١٤/١٢/٢٠٢٢، ١٩:٠٥ - محمد: مرحبا").sender, "محمد");
        assert.equal(parseHeaderLine("١٤/١٢/٢٠٢٢، ٧:٠٥ م - محمد: مرحبا").timestamp.time.period, "pm");
    });
});

// ─── Localized digits ────────────────────────────────────────────────────────

describe("localized digits", () => {
    test("normalizeDigits maps Persian, Arabic-Indic, Devanagari, Bengali and Thai digits", () => {
        assert.equal(normalizeDigits("۱۴۰۵/۶/۱۱"), "1405/6/11");
        assert.equal(normalizeDigits("١٤/١٢/٢٠٢٢"), "14/12/2022");
        assert.equal(normalizeDigits("१४/१२/२२"), "14/12/22");
        assert.equal(normalizeDigits("১৪/১২/২২"), "14/12/22");
        assert.equal(normalizeDigits("๑๔/๑๒/๖๕"), "14/12/65");
        assert.equal(normalizeDigits("abc 123"), "abc 123");
    });
    test("length is preserved so offsets map back to the original text", () => {
        for (const text of ["۱۴۰۵/۶/۱۱, ۱۹:۰۵", "١٤\u200f/١٢\u200f/٢٠٢٢، ٧:٠٥ م", "१४/१२/२२, ७:०५ AM"]) {
            assert.equal(normalizeDigits(text).length, text.length);
        }
    });
    test("fa-IR iOS export: Persian digits, Persian calendar, no era", () => {
        const header = parseHeaderLine("[۱۴۰۵/۶/۱۱, ۱۹:۰۵:۰۹] علی: سلام");
        assert.equal(header.kind, "message");
        assert.equal(header.sender, "علی");
        assert.equal(header.timestamp.dateLabel, "۱۴۰۵/۶/۱۱");   // original digits kept for display
        assert.equal(header.timestamp.time.raw, "۱۹:۰۵:۰۹");
        assert.equal(hourOf(header.timestamp.time), 19);
        assert.equal(inferDateOrder(["۱۴۰۵/۶/۱۱", "۱۴۰۵/۶/۱۲", "۱۴۰۵/۷/۱"]), "YMD");
        assert.equal(parseDateLabel("۱۴۰۵/۶/۱۱", { order: "YMD" }).toDateString(), "Wed Sep 02 2026");
    });
    test("ar-EG Android export: Arabic-Indic digits, RLM inside the date, Arabic comma and PM marker", () => {
        const header = parseHeaderLine("١٤\u200f/١٢\u200f/٢٠٢٢، ٧:٠٥ م - أحمد: مرحبا");
        assert.equal(header.kind, "message");
        assert.equal(header.sender, "أحمد");
        assert.equal(header.content, "مرحبا");
        assert.equal(hourOf(header.timestamp.time), 19);
        assert.equal(parseDateLabel(header.timestamp.dateLabel, { order: "DMY" }).toDateString(), "Wed Dec 14 2022");
    });
    test("mr-IN Android export: Devanagari digits with Latin AM/PM", () => {
        const header = parseHeaderLine("१४/१२/२२, ७:०५ PM - राज: नमस्ते");
        assert.equal(header.sender, "राज");
        assert.equal(hourOf(header.timestamp.time), 19);
    });
});

// ─── Calendars ───────────────────────────────────────────────────────────────

describe("Solar Hijri (AP)", () => {
    test("known anchors", () => {
        assert.deepEqual(persianToGregorian(1405, 6, 11), [2026, 9, 2]);
        assert.deepEqual(persianToGregorian(1405, 6, 3), [2026, 8, 25]);
        assert.deepEqual(persianToGregorian(1400, 1, 1), [2021, 3, 21]);
        assert.deepEqual(persianToGregorian(1388, 1, 1), [2009, 3, 21]);
        assert.equal(parseDateLabel("6/11/1405 AP", { order: "MDY" }).toDateString(), "Wed Sep 02 2026");
    });
    test("Farvardin 1", () => {
        assert.equal(parseDateLabel("1/1/1405 AP", { order: "DMY" }).toDateString(), "Sat Mar 21 2026");
        assert.equal(parseDateLabel("1/1/1404 AP", { order: "DMY" }).toDateString(), "Fri Mar 21 2025");
    });
    test("Esfand 29 and 30", () => {
        assert.equal(isPersianLeapYear(1403), true);
        assert.equal(isPersianLeapYear(1404), false);
        assert.equal(parseDateLabel("29/12/1403 AP", { order: "DMY" }).toDateString(), "Wed Mar 19 2025");
        assert.equal(parseDateLabel("30/12/1403 AP", { order: "DMY" }).toDateString(), "Thu Mar 20 2025"); // leap year
        assert.equal(parseDateLabel("29/12/1404 AP", { order: "DMY" }).toDateString(), "Fri Mar 20 2026");
        assert.equal(parseDateLabel("30/12/1404 AP", { order: "DMY" }), null);                              // not a leap year
        assert.equal(parseDateLabel("31/7/1405 AP", { order: "DMY" }), null);                               // Mehr has 30 days
        assert.equal(parseDateLabel("31/6/1405 AP", { order: "DMY" }).toDateString(), "Tue Sep 22 2026");   // Shahrivar has 31
    });
    test("round-trips ICU's Persian calendar for every day from 1900 to 2100", () => {
        const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
            year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC"
        });
        let checked = 0;
        for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
            const date = new Date(t);
            const p = Object.fromEntries(fmt.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]));
            const [gy, gm, gd] = persianToGregorian(p.year, p.month, p.day);
            if (gy !== date.getUTCFullYear() || gm !== date.getUTCMonth() + 1 || gd !== date.getUTCDate()) {
                assert.fail(`${date.toISOString().slice(0, 10)} → ${p.year}/${p.month}/${p.day} → ${gy}-${gm}-${gd}`);
            }
            checked += 1;
        }
        assert.ok(checked > 73000);
    });
    test("leap-year rule agrees with ICU for 1300–1500 AP", () => {
        const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });
        for (let year = 1300; year <= 1500; year += 1) {
            // ICU: 30 Esfand exists iff the day after 29 Esfand is still in month 12.
            const [gy, gm, gd] = persianToGregorian(year, 12, 29);
            const next = new Date(Date.UTC(gy, gm - 1, gd) + 86400000);
            const p = Object.fromEntries(fmt.formatToParts(next).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]));
            assert.equal(isPersianLeapYear(year), p.month === 12, `year ${year}`);
        }
    });
    test("the ICU short format for en-US + Persian calendar is what the parser accepts", () => {
        const text = new Intl.DateTimeFormat("en-US", { calendar: "persian", dateStyle: "short", timeStyle: "medium" }).format(new Date(2026, 8, 2, 7, 41, 5));
        const header = parseHeaderLine(`[${text}] Alex: Hi`);
        assert.equal(header.kind, "message");
        assert.equal(parseDateLabel(header.timestamp.dateLabel, { order: "MDY" }).toDateString(), "Wed Sep 02 2026");
    });
});

describe("Buddhist Era (BE)", () => {
    test("converts known dates", () => {
        assert.equal(parseDateLabel("14/12/2565 BE", { order: "DMY" }).toDateString(), "Wed Dec 14 2022");
        assert.equal(parseDateLabel("9/2/2569 BE", { order: "MDY" }).toDateString(), "Wed Sep 02 2026");
        assert.equal(parseDateLabel("1/1/2552 BE", { order: "DMY" }).toDateString(), "Thu Jan 01 2009");
    });
    test("the ICU short format for en-US + Buddhist calendar is what the parser accepts", () => {
        const text = new Intl.DateTimeFormat("en-US", { calendar: "buddhist", dateStyle: "short", timeStyle: "medium" }).format(new Date(2026, 8, 2, 7, 41, 5));
        const header = parseHeaderLine(`[${text}] Alex: Hi`);
        assert.equal(parseDateLabel(header.timestamp.dateLabel, { order: "MDY" }).toDateString(), "Wed Sep 02 2026");
    });
    test("Thai two-digit years need the explicit Buddhist setting", () => {
        // th-TH prints "14/12/65" for 2022 — indistinguishable from a Gregorian
        // 2065 without knowing the calendar, so automatic mode leaves it alone…
        assert.equal(parseDateLabel("14/12/65", { order: "DMY" }).getFullYear(), 2065);
        // …and the setting resolves it.
        assert.equal(parseDateLabel("14/12/65", { order: "DMY", calendar: "buddhist" }).toDateString(), "Wed Dec 14 2022");
    });
});

describe("calendar detection", () => {
    test("era tokens decide in automatic mode", () => {
        assert.equal(calendarForLabel({ era: "AP" }), "persian");
        assert.equal(calendarForLabel({ era: "BE" }), "buddhist");
        assert.equal(calendarForLabel({ era: "AH" }), "islamic");
        assert.equal(calendarForLabel({ era: "AD" }), "gregorian");
        assert.equal(calendarForLabel({ era: "CE" }), "gregorian");
    });
    test("four-digit year ranges that cannot be Gregorian decide when there is no era", () => {
        assert.equal(calendarForLabel({ yearRaw: "1405" }), "persian");
        assert.equal(calendarForLabel({ yearRaw: "1448" }), "islamic");
        assert.equal(calendarForLabel({ yearRaw: "2565" }), "buddhist");
        assert.equal(calendarForLabel({ yearRaw: "2022" }), "gregorian");
        assert.equal(calendarForLabel({ yearRaw: "22" }), "gregorian");
        assert.equal(calendarForLabel({ yearRaw: "65" }), "gregorian");
    });
    test("Islamic dates are recognised but never converted", () => {
        assert.equal(parseDateLabel("3/21/1448 AH", { order: "MDY" }), null);
        assert.equal(parseDateLabel("21/3/1448", { order: "DMY" }), null);
        // The header itself still parses, so the chat renders with the original label.
        assert.equal(parseHeaderLine("[3/21/1448 AH, 7:05:09 PM] Alex: Hi").kind, "message");
    });
    test("an explicit calendar setting always wins", () => {
        assert.equal(calendarForLabel({ era: "AP", calendar: "gregorian" }), "gregorian");
        assert.equal(calendarForLabel({ yearRaw: "1405", calendar: "buddhist" }), "buddhist");
        assert.equal(parseDateLabel("6/11/1405 AP", { order: "MDY", calendar: "gregorian" }).getFullYear(), 1405);
        assert.equal(parseDateLabel("14/12/22", { order: "DMY", calendar: "persian" }).toDateString(), "Fri Mar 04 2044"); // 14 Esfand 1422
        assert.equal(parseDateLabel("14/12/65", { order: "DMY", calendar: "buddhist" }).toDateString(), "Wed Dec 14 2022"); // 2565 BE
    });
    test("gregorian setting keeps v1.6.0 year handling", () => {
        assert.equal(parseDateLabel("14/12/22", { order: "DMY", calendar: "gregorian" }).getFullYear(), 2022);
        assert.equal(parseDateLabel("14/12/99", { order: "DMY", calendar: "gregorian" }).getFullYear(), 1999);
        assert.equal(parseDateLabel("14/12/2022", { order: "DMY", calendar: "gregorian" }).getFullYear(), 2022);
    });
});

// ─── Date order ──────────────────────────────────────────────────────────────

describe("date order", () => {
    test("inference picks the order that keeps labels valid and chronological", () => {
        assert.equal(inferDateOrder(["12/14/22", "12/15/22", "1/2/23"]), "MDY");
        assert.equal(inferDateOrder(["14/12/22", "15/12/22", "2/1/23"]), "DMY");
        assert.equal(inferDateOrder(["2022/12/14", "2022/12/15"]), "YMD");
        assert.equal(inferDateOrder(["6/11/1405 AP", "6/12/1405 AP", "6/13/1405 AP"]), "MDY");
        assert.equal(inferDateOrder([], { tieBreak: "MDY" }), "MDY");
        assert.equal(inferDateOrder(["1/2/22"], { tieBreak: "DMY" }), "DMY");
    });
    test("an explicit setting wins over inference; automatic uses inference", () => {
        assert.equal(resolveDateOrder("mdy", "DMY"), "MDY");
        assert.equal(resolveDateOrder("ymd", "DMY"), "YMD");
        assert.equal(resolveDateOrder("dmy", "MDY"), "DMY");
        assert.equal(resolveDateOrder("auto", "MDY"), "MDY");
        assert.equal(resolveDateOrder(undefined, "YMD"), "YMD");
        assert.equal(resolveDateOrder("garbage", "MDY"), "MDY");
    });
    test("YMD requires a four-digit leading year", () => {
        assert.equal(parseDateLabel("22/12/14", { order: "YMD" }), null);
        assert.equal(parseDateLabel("2022/12/14", { order: "YMD" }).toDateString(), "Wed Dec 14 2022");
    });
    test("invalid dates are rejected rather than rolled over", () => {
        assert.equal(parseDateLabel("31/2/22", { order: "DMY" }), null);
        assert.equal(parseDateLabel("14/13/22", { order: "DMY" }), null);
        assert.equal(parseDateLabel("0/1/22", { order: "DMY" }), null);
        assert.equal(parseDateLabel("not a date"), null);
        assert.equal(parseDateLabel(""), null);
    });
});

// ─── Attachments ─────────────────────────────────────────────────────────────

describe("attachment filenames", () => {
    const zipName = (name) => attachmentLookupKey(name);
    const chatName = (token) => attachmentLookupKey(extractAttachmentTokens(stripInvisible(token))[0].fileName);

    test("ASCII, spaces and case", () => {
        assert.equal(chatName("<attached: 00000033-AUDIO-2026-08-25-10-08-24.opus>"), zipName("00000033-AUDIO-2026-08-25-10-08-24.opus"));
        assert.equal(chatName("<attached: My Holiday Photo.JPG>"), zipName("My Holiday Photo.JPG"));
        assert.equal(zipName("My Holiday Photo.JPG"), "my holiday photo.jpg");
        assert.equal(chatName("IMG-20240101-WA0001.jpg (file attached)"), zipName("IMG-20240101-WA0001.jpg"));
    });
    test("ZIP paths reduce to the base name", () => {
        assert.equal(zipName("WhatsApp Chat - Alex/00000001-PHOTO.jpg"), "00000001-photo.jpg");
        assert.equal(zipName("folder\\00000001-PHOTO.jpg"), "00000001-photo.jpg");
    });
    test("Unicode names", () => {
        assert.equal(chatName("<attached: Café résumé.pdf>"), zipName("Café résumé.pdf"));
        assert.equal(chatName("<attached: 写真.jpg>"), zipName("写真.jpg"));
    });
    test("Arabic and Hebrew names", () => {
        assert.equal(chatName("<attached: 00000611-ارزیابی زوزه.pdf>"), zipName("00000611-ارزیابی زوزه.pdf"));
        assert.equal(chatName("<attached: מסמך חשוב.pdf>"), zipName("מסמך חשוב.pdf"));
    });
    test("directional and formatting characters in the chat reference", () => {
        const zip = zipName("00000611-ارزیابی زوزه.pdf");
        assert.equal(chatName("<attached: 00000611-\u200eارزیابی زوزه.pdf>"), zip);                 // LRM
        assert.equal(chatName("<attached: 00000611-\u200fارزیابی زوزه.pdf>"), zip);                 // RLM
        assert.equal(chatName("<attached: 00000611-\u2066ارزیابی زوزه\u2069.pdf>"), zip);           // LRI…PDI
        assert.equal(chatName("<attached: 00000611-\u2067ارزیابی زوزه\u2069.pdf>"), zip);           // RLI…PDI
        assert.equal(chatName("<attached: 00000611-\u200e\u2068ارزیابی زوزه\u2069.pdf>"), zip);     // LRM + FSI…PDI (iOS)
        assert.equal(chatName("<attached: 00000611-\u061cارزیابی زوزه.pdf>"), zip);                 // ALM
        assert.equal(chatName("\ufeff<attached: 00000611-ارزیابی زوزه.pdf>"), zip);                 // BOM
        assert.equal(chatName("<attached: \u202b00000611-ارزیابی زوزه\u202c.pdf>"), zip);           // RLE…PDF
        assert.equal(chatName("<attached: 00000611-\u200bارزیابی زوزه.pdf>"), zip);                 // ZWSP
    });
    test("NFC and NFD spellings resolve to the same key", () => {
        const nfc = "00000612-آزمون résumé.pdf".normalize("NFC");
        const nfd = nfc.normalize("NFD");
        assert.notEqual(nfc, nfd);
        assert.equal(zipName(nfd), zipName(nfc));
        assert.equal(chatName(`<attached: ${nfc}>`), zipName(nfd));
        assert.equal(chatName(`<attached: ${nfd}>`), zipName(nfc));
    });
    test("legitimate characters are never stripped", () => {
        for (const name of ["a b.c", "x-y_z (1).jpg", "naïve.txt", "日本語 ファイル.pdf", "עברית.docx", "emoji 🎉.png", "tab\there.txt"]) {
            assert.equal(zipName(name), name.normalize("NFC").toLowerCase());
        }
    });
    test("stripInvisible removes exactly the invisible set", () => {
        assert.equal(stripInvisible("a\u200bb\u200ec\u200fd\u202ae\u202ef\u2066g\u2069h\u061ci\ufeffj"), "abcdefghij");
        assert.equal(stripInvisible("a b\u00a0c\u202fd"), "a b\u00a0c\u202fd"); // spaces are visible
    });
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

describe("unrecognised timestamp diagnostics", () => {
    test("flags lines that start like a timestamp", () => {
        assert.equal(looksLikeTimestampLine("[2022-12-14 07 h 05 min 09 s] Alex: Hi"), true);  // fr-CA: bracketed date, unsupported time
        assert.equal(looksLikeTimestampLine("[R6/1/1, 10:00:00] Alex: Hi"), false);              // ja-JP era prefix: not a numeric date
        assert.equal(looksLikeTimestampLine("2022-12-14 07 h 05 min 09 s - Alex: Hi"), false);   // unbracketed needs h:mm
        assert.equal(looksLikeTimestampLine("[1/2/3] not a chat"), true);
        assert.equal(looksLikeTimestampLine("14/12/2022 ⏰ 07:05 - Alex: Hi"), true);
        assert.equal(looksLikeTimestampLine("[۱۴۰۵/۶/۱۱ ساعت ۱۹:۰۵] علی: سلام"), true);
        assert.equal(looksLikeTimestampLine("just text"), false);
        assert.equal(looksLikeTimestampLine(""), false);
    });
});
