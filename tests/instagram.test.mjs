import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const { fixMojibake } = await versioned("../js/instagram/mojibake.js");
const {
    buildMediaStore,
    findMedia,
    findThreads,
    folderLabel,
    initialsFor,
    normalizeKey,
    parseMessageFile,
    parseMessages,
    sortMessageFiles,
    sortMessagesChronologically
} = await versioned("../js/instagram/parser.js");
const { igState } = await versioned("../js/instagram/state.js");
const { filterMessagesBySender, getInstagramSenders, getInstagramSenderSummary } = await versioned("../js/instagram/filter.js");
const { DEFAULT_IG_SETTINGS, formatDateLabel, formatMessageTime, localDateBounds } = await versioned("../js/instagram/format.js");
const { findMessageForDate, findMessageIdForDate } = await versioned("../js/instagram/date-jump-model.js");
const { findMessageSearchResults, nextSearchIndex } = await versioned("../js/instagram/search-model.js");
const { readInstagramSettings, sanitizeInstagramSettings, writeInstagramSettings, IG_SETTINGS_KEY } = await versioned("../js/instagram/settings.js");
const { summarizeInstagramThread } = await versioned("../js/instagram/wrapped-model.js");
const { importsOfKind } = await versioned("../js/shared/import-records.js");
const { filterThreadOptions, initialThreadSelection, makeThreadOptions } = await versioned("../js/instagram/threads-model.js");

/** Pure helpers of the Instagram viewer. */

describe("instagram/mojibake", () => {
    const mangle = (text) => Buffer.from(text, "utf8").toString("latin1");

    test("repairs latin1-mangled UTF-8", () => {
        assert.equal(fixMojibake(mangle("café")), "café");
        assert.equal(fixMojibake(mangle("😀 ok")), "😀 ok");
    });

    test("leaves real Unicode and plain ASCII alone", () => {
        assert.equal(fixMojibake("café"), "café");
        assert.equal(fixMojibake("😀"), "😀");
        assert.equal(fixMojibake("plain"), "plain");
        assert.equal(fixMojibake(""), "");
        assert.equal(fixMojibake(null), null);
    });

    test("does not corrupt latin1 text that isn't valid UTF-8", () => {
        // "é" alone (0xE9) is not a valid UTF-8 sequence, so it was never mojibaked.
        assert.equal(fixMojibake("é"), "é");
    });
});

describe("instagram/parser helpers", () => {
    test("folderLabel drops the numeric suffix and underscores", () => {
        assert.equal(folderLabel("jane_doe_1234567890"), "jane doe");
        assert.equal(folderLabel("groupchat_abc123"), "groupchat");
        assert.equal(folderLabel("solo"), "solo");
    });

    test("findThreads groups message files by inbox folder", () => {
        const entries = [
            { filename: "messages/inbox/a_1/message_1.json" },
            { filename: "messages/inbox/a_1/message_2.json" },
            { filename: "messages/inbox/b_2/message_1.json" },
            { filename: "messages/inbox/b_2/photos/x.jpg" },
            { filename: "messages/inbox/", directory: true },
            { filename: "other/message_1.json" }
        ];
        const threads = findThreads(entries);
        assert.deepEqual(threads.map((t) => [t.folder, t.files.length]), [["a_1", 2], ["b_2", 1]]);
    });

    test("sortMessageFiles orders message_N.json numerically", () => {
        const files = ["message_10.json", "message_2.json", "message_1.json"].map((n) => ({ filename: `x/${n}` }));
        assert.deepEqual(sortMessageFiles(files).map((f) => f.filename), ["x/message_1.json", "x/message_2.json", "x/message_10.json"]);
    });

    test("initialsFor", () => {
        assert.equal(initialsFor("Jane Doe"), "JD");
        assert.equal(initialsFor("jane"), "JA");
        assert.equal(initialsFor("  "), "?");
    });

    test("normalizeKey lower-cases and forward-slashes", () => {
        assert.equal(normalizeKey(" A\\B\\C.JPG "), "a/b/c.jpg");
    });

    test("message part parsing rejects empty, malformed, and non-object JSON", () => {
        assert.equal(parseMessageFile(""), null);
        assert.equal(parseMessageFile("{"), null);
        assert.equal(parseMessageFile("not json"), null);
        assert.equal(parseMessageFile("[]"), null);
        assert.deepEqual(parseMessageFile('{"messages":[]}'), { messages: [] });
    });

    test("message arrays sort chronologically and preserve stable equal-time order", () => {
        const messages = [
            { id: "late", timestamp_ms: 30 },
            { id: "first-tie", timestamp_ms: 10 },
            null,
            { id: "second-tie", timestamp_ms: 10 },
            { id: "early", timestamp_ms: 1 }
        ];
        assert.deepEqual(sortMessagesChronologically(messages).map((message) => message.id), ["early", "first-tie", "second-tie", "late"]);
    });

    test("thread options sort/filter by label and restore only a valid preferred thread", () => {
        const threads = [
            { folder: "zeta_123456789", files: [{}, {}] },
            { folder: "alpha_123456789", files: [{}] }
        ];
        const options = makeThreadOptions(threads, folderLabel);
        assert.deepEqual(options.map((option) => option.label), ["alpha", "zeta"]);
        assert.deepEqual(filterThreadOptions(options, " ZET ").map((option) => option.label), ["zeta"]);
        assert.equal(filterThreadOptions(options, "absent").length, 0);
        assert.equal(initialThreadSelection(threads), null, "multiple threads require an explicit choice");
        assert.equal(initialThreadSelection(threads, "zeta_123456789"), threads[0]);
        assert.equal(initialThreadSelection(threads, "missing"), null);
        assert.equal(initialThreadSelection([threads[1]]), threads[1]);
    });
});

function resetInstagramState() {
    igState.messages = [];
    igState.filteredMessages = [];
    igState.selectedSenders = [];
    igState.messageOnlyCount = 0;
    igState.myName = "Me";
    igState.chatTitle = "Test thread";
    igState.colorMap = {};
    igState.senderStats = {};
    igState.emojiStats = {};
    igState.hourlyStats = Array(24).fill(0);
    igState.mediaCount = 0;
    igState.mediaMissingCount = 0;
    igState.renderRange = { start: 0, end: 0 };
    igState.mediaStore.clear();
    igState.mediaLookup.clear();
    igState.mediaUrls.clear();
    igState.settings = { ...DEFAULT_IG_SETTINGS };
}

describe("Instagram message normalization and media", () => {
    beforeEach(resetInstagramState);

    test("normalizes Unicode, multiline text, timestamps, reactions, shares, and date markers", () => {
        const first = new Date(2024, 0, 2, 13, 15).getTime();
        const sameDay = first + 60_000;
        const nextDay = new Date(2024, 0, 3, 8, 0).getTime();
        parseMessages([
            { sender_name: "Friend", timestamp_ms: first, content: Buffer.from("café\nhello 👋", "utf8").toString("latin1"), reactions: [{ reaction: "💛", actor: "Me" }], share: { link: "https://example.test/post", share_text: "A shared post" } },
            { sender_name: "Me", timestamp_ms: sameDay, content: "second line\ncontinued" },
            { sender_name: "Friend", timestamp_ms: nextDay, content: "new day 🌅" },
            { sender_name: "Friend", timestamp_ms: nextDay + 1, content: "   " }
        ]);

        assert.equal(igState.messageOnlyCount, 3);
        assert.equal(igState.messages.filter((message) => message.type === "date").length, 2);
        assert.equal(igState.messages[1].text, "café\nhello 👋");
        assert.equal(igState.messages[1].isMe, false);
        assert.equal(igState.messages[2].isMe, true);
        assert.equal(igState.messages[1].reactions[0].reaction, "💛");
        assert.equal(igState.messages[1].shareLink, "https://example.test/post");
        assert.equal(igState.messages[1].shareText, "A shared post");
        assert.equal(igState.messages[1].ts, first);
        assert.equal(igState.senderStats.Friend, 2);
        assert.equal(igState.senderStats.Me, 1);
        assert.equal(igState.emojiStats["👋"], 1);
        assert.equal(igState.hourlyStats[new Date(first).getHours()], 2);
    });

    test("registers full-path media, resolves duplicate basenames, and leaves missing files as placeholders", () => {
        const mediaEntry = (filename) => ({ filename, directory: false, getData: async () => new Blob() });
        buildMediaStore([
            mediaEntry("messages/inbox/group_a/photos/same.jpg"),
            mediaEntry("messages/inbox/group_b/photos/same.jpg"),
            mediaEntry("messages/inbox/group_a/files/notes.pdf"),
            mediaEntry("messages/inbox/group_a/message_1.json")
        ]);
        const firstPath = findMedia("messages/inbox/group_a/photos/same.jpg");
        const secondPath = findMedia("messages/inbox/group_b/photos/same.jpg");
        assert.ok(firstPath && secondPath);
        assert.notEqual(firstPath.id, secondPath.id);

        parseMessages([{
            sender_name: "Friend",
            timestamp_ms: new Date(2024, 3, 4).getTime(),
            photos: [{ uri: "messages/inbox/group_a/photos/same.jpg" }],
            files: [{ uri: "messages/inbox/group_a/files/notes.pdf" }],
            videos: [{ uri: "messages/inbox/group_a/videos/missing.mp4" }]
        }]);

        const message = igState.messages.find((item) => item.type === "msg");
        assert.deepEqual(message.mediaItems.map((item) => item.status), ["available", "missing", "available"]);
        assert.equal(message.mediaItems[1].name, "missing.mp4");
        assert.equal(message.mediaItems[2].kind, "document");
        assert.equal(igState.mediaCount, 3);
        assert.equal(igState.mediaMissingCount, 1);
    });

    test("empty or malformed input does not throw or create a message", () => {
        assert.doesNotThrow(() => parseMessages(null));
        assert.doesNotThrow(() => parseMessages([]));
        assert.equal(igState.messageOnlyCount, 0);
        assert.deepEqual(igState.filteredMessages, []);
    });

    test("message IDs and date markers are deterministic for the same source sequence", () => {
        const records = [
            { sender_name: "A", timestamp_ms: 1000, content: "one" },
            { sender_name: "B", timestamp_ms: 2000, content: "two" }
        ];
        parseMessages(records);
        const ids = igState.messages.map((message) => message.id);
        resetInstagramState();
        parseMessages(records);
        assert.deepEqual(igState.messages.map((message) => message.id), ids);
    });
});

describe("Instagram filtering, search, dates, and display settings", () => {
    beforeEach(resetInstagramState);

    const messages = [
        { type: "date", content: "day 1", ts: new Date(2024, 0, 1).getTime(), id: "d1" },
        { type: "msg", id: "m1", ts: new Date(2024, 0, 1, 10).getTime(), sender: "Alice", text: "Shared weekend plans", shareText: "Dinner idea", shareLink: "https://example.test", reactions: [{ reaction: "💛", actor: "Bob" }], mediaItems: [{ name: "photo.jpg" }] },
        { type: "msg", id: "m2", ts: new Date(2024, 0, 1, 11).getTime(), sender: "Bob", text: "See you then", mediaItems: [] },
        { type: "date", content: "day 2", ts: new Date(2024, 0, 2).getTime(), id: "d2" },
        { type: "msg", id: "m3", ts: new Date(2024, 0, 2, 9).getTime(), sender: "Alice", text: "Confirmed", mediaItems: [] }
    ];

    test("sender filtering preserves relevant date markers without orphan markers", () => {
        const alice = filterMessagesBySender(messages, ["Alice"]);
        assert.deepEqual(alice.map((message) => message.id), ["d1", "m1", "d2", "m3"]);
        assert.equal(filterMessagesBySender(messages, []).length, messages.length);
        assert.deepEqual(getInstagramSenders(messages), ["Alice", "Bob"]);
        assert.equal(getInstagramSenderSummary(["Alice", "Bob"]), "2 participants");
    });

    test("search covers sender, text, media, shares, and Instagram reactions; navigation wraps", () => {
        assert.deepEqual(findMessageSearchResults(messages, "weekend"), ["m1"]);
        assert.deepEqual(findMessageSearchResults(messages, "photo.jpg"), ["m1"]);
        assert.deepEqual(findMessageSearchResults(messages, "dinner idea"), ["m1"]);
        assert.deepEqual(findMessageSearchResults(messages, "💛"), ["m1"]);
        assert.deepEqual(findMessageSearchResults(messages, "no match"), []);
        assert.deepEqual(findMessageSearchResults(messages, "  "), []);
        assert.equal(nextSearchIndex(0, 3, "up"), 2);
        assert.equal(nextSearchIndex(2, 3, "down"), 0);
        assert.equal(nextSearchIndex(0, 0, "down"), -1);
    });

    test("search handles large conversations in one deterministic pass", () => {
        const many = Array.from({ length: 25_000 }, (_, index) => ({
            type: "msg", id: `m${index}`, sender: "Friend", text: index % 2500 === 0 ? "needle" : "ordinary message", mediaItems: []
        }));
        assert.deepEqual(findMessageSearchResults(many, "needle"), ["m0", "m2500", "m5000", "m7500", "m10000", "m12500", "m15000", "m17500", "m20000", "m22500"]);
    });

    test("date jump uses local calendar boundaries and finds the first matching message", () => {
        const bounds = localDateBounds("2024-01-02");
        assert.ok(bounds);
        assert.equal(bounds.end - bounds.start, new Date(2024, 0, 3).getTime() - new Date(2024, 0, 2).getTime());
        assert.equal(findMessageIdForDate(messages, "2024-01-02"), "m3");
        assert.equal(findMessageIdForDate(messages, "not-a-date"), "");
        assert.deepEqual(findMessageForDate(messages, new Date(2024, 0, 3).getTime(), new Date(2024, 0, 4).getTime()), { id: "m3", exact: false });
        assert.equal(findMessageForDate(messages, new Date(2023, 11, 31).getTime(), new Date(2024, 0, 1).getTime()), null);
    });

    test("time/date settings format timestamps and reject invalid preference values", () => {
        const timestamp = new Date(2024, 1, 3, 13, 7, 9).getTime();
        const time24 = formatMessageTime(timestamp, { ...DEFAULT_IG_SETTINGS, timeFormat: "24", showSeconds: true });
        assert.match(time24, /13:07:09/);
        assert.equal(formatMessageTime(timestamp, { ...DEFAULT_IG_SETTINGS, timeFormat: "24", timeBrackets: "square" }).startsWith("["), true);
        assert.equal(formatDateLabel(timestamp, { ...DEFAULT_IG_SETTINGS, dateFormat: "dmy" }), "03/02/2024");
        assert.equal(formatDateLabel(timestamp, { ...DEFAULT_IG_SETTINGS, dateFormat: "ymd", dateSeparator: ".", dateBrackets: "round" }), "(2024.02.03)");

        const clean = sanitizeInstagramSettings({ timeFormat: "nonsense", dateFormat: "bad", showSenderNames: false, persistentStorage: true });
        assert.equal(clean.timeFormat, DEFAULT_IG_SETTINGS.timeFormat);
        assert.equal(clean.dateFormat, DEFAULT_IG_SETTINGS.dateFormat);
        assert.equal(clean.showSenderNames, false);
        assert.equal(clean.persistentStorage, true);
    });

    test("Instagram settings use a separate key and round-trip safely", () => {
        const values = new Map([["chatlume-settings", "whatsapp"], [IG_SETTINGS_KEY, JSON.stringify({ timeFormat: "24" })]]);
        const fakeStorage = {
            getItem(key) { return values.get(key) ?? null; },
            setItem(key, value) { values.set(key, value); }
        };
        assert.equal(readInstagramSettings(fakeStorage).timeFormat, "24");
        writeInstagramSettings({ ...DEFAULT_IG_SETTINGS, persistentStorage: true }, fakeStorage);
        assert.equal(JSON.parse(values.get(IG_SETTINGS_KEY)).persistentStorage, true);
        assert.equal(values.get("chatlume-settings"), "whatsapp");
    });
});

describe("Instagram Wrapped and kind-scoped storage", () => {
    test("Wrapped totals messages, words, media, peak hour, date range, emojis and senders", () => {
        const summary = summarizeInstagramThread([
            { type: "date", ts: 10 },
            { type: "msg", ts: 100, text: "hello there", sender: "Alice" },
            { type: "msg", ts: 200, text: "world", sender: "Bob" }
        ], { mediaCount: 2, hourlyStats: [0, 2, 4], emojiStats: { "💛": 3 }, senderStats: { Alice: 1, Bob: 1 } });
        assert.deepEqual(summary, {
            messageCount: 2, totalWords: 3, mediaCount: 2, peakHour: 2,
            firstTimestamp: 100, lastTimestamp: 200,
            topEmojis: [["💛", 3]], topSenders: [["Alice", 1], ["Bob", 1]]
        });
    });

    test("kind filtering prevents Instagram storage operations from selecting WhatsApp records", () => {
        const records = [{ id: "w", kind: "whatsapp" }, { id: "i", kind: "instagram" }, { id: "old" }];
        assert.deepEqual(importsOfKind(records, "instagram"), [records[1]]);
        assert.deepEqual(importsOfKind(records, "whatsapp"), [records[0]]);
        assert.equal(importsOfKind(records, "instagram").length, 1);
        const instagramPersistence = readFileSync(new URL("../js/instagram/persistence.js", import.meta.url), "utf8");
        const whatsappPersistence = readFileSync(new URL("../js/whatsapp/persistence.js", import.meta.url), "utf8");
        assert.match(instagramPersistence, /deleteImportsByKind\("instagram"\)/);
        assert.match(whatsappPersistence, /deleteImportsByKind\("whatsapp"\)/);
    });
});

describe("Instagram UI integration contracts", () => {
    test("thread switching, settings, search, date jump, media and Wrapped controls are wired", () => {
        const html = readFileSync(new URL("../public/instagram-viewer.html", import.meta.url), "utf8");
        const script = readFileSync(new URL("../js/instagram.js", import.meta.url), "utf8");
        const session = readFileSync(new URL("../js/instagram/session.js", import.meta.url), "utf8");
        for (const id of ["ig-change-thread", "ig-live-search", "ig-sender-filter-btn", "ig-date-jump-action", "ig-generate-wrapped", "ig-setting-persistent-storage", "ig-storage-list", "ig-media-modal"]) {
            assert.ok(html.includes(`id="${id}"`), `${id} exists in the viewer`);
        }
        assert.match(script, /\$\("ig-live-search"\)\?\.addEventListener\("input"/);
        assert.match(script, /\$\("ig-change-thread"\)\?\.addEventListener\("click"/);
        assert.match(script, /senderDropdown\.hidden = true;[\s\S]*setAttribute\("aria-expanded", "false"\)/);
        assert.match(script, /\[data-ig-setting\].*addEventListener\("change"/s);
        assert.match(session, /setLoading\(true, "Opening ZIP"[\s\S]*?try \{\s*await yieldToPaint\(\)/,
            "ZIP startup waits must be inside the error-handled loading flow");
        assert.match(session, /setLoading\(true, "Loading thread"[\s\S]*?try \{\s*await yieldToPaint\(\)/,
            "thread startup waits must be inside the finally-protected loading flow");
        assert.match(session, /finally \{\s*if \(!isStale\(\)\) setLoading\(false\);/,
            "the active thread load always releases the processing overlay");
        assert.doesNotMatch(script, /from ["']https:\/\/cdn\.jsdelivr\.net\/npm\/@zip\.js/,
            "the ZIP CDN must not be part of the viewer's startup module graph");
        assert.match(session, /function loadZipApi\(\)[\s\S]*?import\(ZIP_JS_URL\)[\s\S]*?catch\(\(error\)/,
            "the ZIP library should load lazily and surface fetch failures through the import flow");
        assert.match(session, /showErrorState\(/);
        assert.match(session, /showEmptyThreadState\(/);
    });
});
