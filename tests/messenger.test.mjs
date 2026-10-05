import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const {
    extractMessageRecords, findThreads, folderLabel, inertHtml, normalizeMessages,
    normalizeZipPath, nodeText, parseHtmlDocument, parseMessengerTimestamp,
    resolveAttachmentRef, sortMessageFiles
} = await versioned("../js/messenger/parser.js");

class Node {
    constructor({ tag = "div", text = "", classes = "", children = [], attrs = {}, map = {} } = {}) {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.nodeValue = "";
        this.childNodes = children;
        this.children = children;
        this.classList = { contains: (name) => classes.split(/\s+/).includes(name) };
        this.attrs = attrs;
        this.map = map;
        if (text) this.childNodes = [{ nodeType: 3, nodeValue: text }];
    }
    matches(selector) { return this.map.matches?.includes(selector) || false; }
    querySelector(selector) { return this.map[selector] || null; }
    querySelectorAll(selector) { return this.map.all?.[selector] || []; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    get textContent() { return this.childNodes.map((n) => n.nodeType === 3 ? n.nodeValue : n.textContent).join(""); }
}

function text(value) { return { nodeType: 3, nodeValue: value }; }
function element(tag, children = [], classes = "", attrs = {}) {
    const node = new Node({ tag, children, classes, attrs });
    for (const child of children) if (child.nodeType === 1) child.parentNode = node;
    return node;
}

function messageBlock(family, { sender, body, time, refs = [] } = {}) {
    const old = family === "old";
    const selectors = old
        ? ["._3-96._2pio._2lek._2lel", "._3-96._2let", "._3-94._2lem"]
        : ["._2ph_._a6-h._a6-i", "._a6-h", "._2ph_._a6-p", "._a6-p", "._a72d"];
    const senderNode = sender == null ? null : element("div", [text(sender)], old ? "_3-96 _2pio _2lek _2lel" : "_2ph_ _a6-h _a6-i");
    const bodyChildren = body == null ? [] : body.map((part) => part === "\n" ? element("br") : element("span", [text(part)]));
    const bodyNode = body == null ? null : element("div", bodyChildren, old ? "_3-96 _2let" : "_2ph_ _a6-p");
    const timeNode = time == null ? null : element("div", [text(time)], old ? "_3-94 _2lem" : "_a72d");
    const refNodes = refs.map((ref) => element(ref.tag || "a", [], "", ref.attrs));
    const map = { matches: [old ? "div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder" : "._a6-g"], all: {} };
    if (old) {
        map[selectors[0]] = senderNode; map[selectors[1]] = bodyNode; map[selectors[2]] = timeNode;
    } else {
        map[selectors[0]] = senderNode; map[selectors[1]] = senderNode;
        map[selectors[2]] = bodyNode; map[selectors[3]] = bodyNode; map[selectors[4]] = timeNode;
    }
    map.all["[data-messenger-ref], a[href], img[src], video[src], audio[src], source[src]"] = refNodes;
    const block = new Node({ tag: "div", classes: old ? "pam _3-95 _2pi0 _2lej uiBoxWhite noborder" : "_a6-g", map });
    return block;
}

function documentWith(...blocks) {
    return { querySelectorAll(selector) {
        if (selector.includes(",")) return blocks;
        if (selector === "div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder") return blocks.filter((b) => b.classList.contains("_3-95"));
        if (selector === "._a6-g") return blocks.filter((b) => b.classList.contains("_a6-g"));
        return [];
    } };
}

describe("Messenger HTML extraction", () => {
    test("extracts the older _3-95 / _3-96 / _2lem structure", () => {
        const [record] = extractMessageRecords(documentWith(messageBlock("old", {
            sender: "Zoë 🌿", body: ["Hello", "\n", "second line"], time: "11/12/2017, 21:48"
        })));
        assert.equal(record.sender, "Zoë 🌿");
        assert.equal(record.text, "Hello\nsecond line");
        assert.equal(record.rawTime, "11/12/2017, 21:48");
    });

    test("extracts newer _a6-g / _a6-h / _a6-p / _a72d structure", () => {
        const [record] = extractMessageRecords(documentWith(messageBlock("new", {
            sender: "Mina", body: ["café 🐈"], time: "Aug 29, 2019, 11:35 PM"
        })));
        assert.deepEqual(record, { sender: "Mina", text: "café 🐈", rawTime: "Aug 29, 2019, 11:35 PM", attachmentRefs: [] });
    });

    test("supports fallback new sender/body class selectors", () => {
        const [record] = extractMessageRecords(documentWith(messageBlock("new", { sender: "Lee", body: ["body"], time: "25 Dec 2019, 00:06" })));
        assert.equal(record.sender, "Lee");
        assert.equal(record.text, "body");
    });

    test("handles missing sender, body and timestamp without throwing", () => {
        const [record] = extractMessageRecords(documentWith(messageBlock("old", {})));
        assert.deepEqual(record, { sender: "Unknown", text: "", rawTime: "", attachmentRefs: [] });
    });

    test("malformed or empty documents simply produce no records", () => {
        assert.deepEqual(extractMessageRecords(documentWith()), []);
    });

    test("preserves DOM order if an archive contains both markup families", () => {
        const newer = messageBlock("new", { sender: "New", body: ["first"], time: "x" });
        const older = messageBlock("old", { sender: "Old", body: ["second"], time: "y" });
        assert.deepEqual(extractMessageRecords(documentWith(newer, older)).map((r) => r.sender), ["New", "Old"]);
    });

    test("extracts local attachment references from links and media elements", () => {
        const refs = [
            { tag: "a", attrs: { href: "photos/photo 1.jpg" } },
            { tag: "video", attrs: { src: "videos/clip.mp4" } }
        ];
        const [record] = extractMessageRecords(documentWith(messageBlock("new", { sender: "Sam", body: ["here"], refs })));
        assert.deepEqual(record.attachmentRefs.map((r) => r.ref), ["photos/photo 1.jpg", "videos/clip.mp4"]);
    });

    test("does not turn shared external links into missing-media cards", () => {
        const refs = [
            { tag: "a", attrs: { href: "https://example.test/a-post" } },
            { tag: "a", attrs: { href: "../../photos/image.jpg" } }
        ];
        const [record] = extractMessageRecords(documentWith(messageBlock("new", { sender: "Sam", body: ["post"], refs })));
        assert.deepEqual(record.attachmentRefs.map((ref) => ref.ref), ["../../photos/image.jpg"]);
    });

    test("sanitizes scripts, remote resources and style attributes before DOMParser", () => {
        const source = '<script>globalThis.__messengerInjected = true</script><img src="https://evil.test/x.png" srcset="photos/local.jpg 1x, https://evil.test/2x 2x" style="background:url(https://evil.test)"><a href="https://evil.test">link</a><img src="photos/local.jpg">';
        const safe = inertHtml(source);
        assert.doesNotMatch(safe, /<script|evil\.test|style=|srcset=/i);
        assert.doesNotMatch(safe, /\ssrc=/i);
        assert.match(safe, /data-messenger-ref="photos\/local\.jpg"/);
        let parsedInput = "";
        class Parser { parseFromString(input) { parsedInput = input; return documentWith(); } }
        parseHtmlDocument(source, Parser);
        assert.equal(parsedInput, safe);
        assert.equal(globalThis.__messengerInjected, undefined);
    });
});

describe("Messenger ZIP discovery and timestamps", () => {
    test("discovers multiple conversation directories without an index", () => {
        const threads = findThreads([
            { filename: "messages/inbox/alex_12345/message_1.html" },
            { filename: "messages/inbox/group_chat_99999/message_1.html" },
            { filename: "messages/inbox/alex_12345/message_2.html" },
            { filename: "messages/inbox/other/message_1.json" },
            { filename: "start_here.html" }
        ]);
        assert.equal(threads.length, 2);
        assert.deepEqual(threads.find((t) => t.folder.includes("alex"))?.files.map((f) => f.filename.match(/message_(\d+)/)[1]), ["1", "2"]);
    });

    test("sorts numbered message parts numerically", () => {
        const files = [10, 2, 1].map((n) => ({ filename: `messages/inbox/a/message_${n}.html` }));
        assert.deepEqual(sortMessageFiles(files).map((f) => f.filename.match(/message_(\d+)/)[1]), ["1", "2", "10"]);
    });

    test("makes a readable fallback title from the conversation directory", () => {
        assert.equal(folderLabel("messages/inbox/alex_smith_123456789"), "alex smith");
    });

    test("parses the observed numeric timestamp without assigning a timezone", () => {
        assert.deepEqual(parseMessengerTimestamp("11/12/2017, 21:48"), {
            rawTime: "11/12/2017, 21:48", ts: null, dateKey: "2017-11-12", time: "21:48", sortKey: "2017-11-12T21:48"
        });
    });

    test("parses observed month-name 12-hour and day-month formats", () => {
        assert.equal(parseMessengerTimestamp("Aug 29, 2019, 11:35 PM").sortKey, "2019-08-29T23:35");
        assert.equal(parseMessengerTimestamp("25 Dec 2019, 00:06").sortKey, "2019-12-25T00:06");
        assert.equal(parseMessengerTimestamp("Aug 29, 2019, 12:05 AM").time, "00:05");
    });

    test("retains unsupported timestamps without creating an epoch", () => {
        assert.deepEqual(parseMessengerTimestamp("Yesterday at noon"), {
            rawTime: "Yesterday at noon", ts: null, dateKey: "", time: "", sortKey: ""
        });
    });
});

describe("Messenger normalization and media", () => {
    const entries = [
        { filename: "messages/inbox/one_123/photos/shared.jpg", getData() {} },
        { filename: "messages/inbox/two_456/photos/shared.jpg", getData() {} },
        { filename: "messages/inbox/one_123/videos/clip.mp4", getData() {} }
    ];

    test("resolves relative attachment references against the HTML path", () => {
        const found = resolveAttachmentRef("photos/shared.jpg", "messages/inbox/one_123/message_1.html", entries);
        assert.equal(found.filename, "messages/inbox/one_123/photos/shared.jpg");
    });

    test("does not match duplicate basenames across conversation folders", () => {
        assert.equal(resolveAttachmentRef("shared.jpg", "messages/inbox/missing/message_1.html", entries), null);
    });

    test("normalizes multiple senders, dates and stable conversation-specific IDs", () => {
        const records = [
            { sender: "Nia", text: "Later 👋", rawTime: "25 Dec 2019, 00:06", sourcePart: 10, sourceIndex: 0 },
            { sender: "Me", text: "Earlier\nmessage", rawTime: "Aug 29, 2019, 11:35 PM", sourcePart: 1, sourceIndex: 0 },
            { sender: "Nia", text: "Group reply", rawTime: "Aug 30, 2019, 12:00 AM", sourcePart: 2, sourceIndex: 1 }
        ];
        const one = normalizeMessages(records, { conversationKey: "messages/inbox/one_123", myName: "Me", entries });
        const two = normalizeMessages(records, { conversationKey: "messages/inbox/two_456", myName: "Me", entries });
        const msgs = one.messages.filter((item) => item.type === "msg");
        assert.deepEqual(msgs.map((m) => m.sender), ["Me", "Nia", "Nia"]);
        assert.equal(msgs[0].isMe, true);
        assert.equal(msgs[0].text, "Earlier\nmessage");
        assert.deepEqual(msgs.map((m) => m.ts), [null, null, null]);
        assert.equal(one.messages.filter((m) => m.type === "date").length, 3);
        assert.notEqual(msgs[0].id, two.messages.find((m) => m.type === "msg").id);
        assert.deepEqual(msgs.map((m) => m.id), one.messages.filter((m) => m.type === "msg").map((m) => m.id));
    });

    test("retains raw time and uses stable source order for unparseable times", () => {
        const result = normalizeMessages([
            { sender: "A", text: "first", rawTime: "unknown", sourcePart: 1, sourceIndex: 0 },
            { sender: "B", text: "dated", rawTime: "11/12/2017, 21:48", sourcePart: 2, sourceIndex: 0 },
            { sender: "A", text: "second", rawTime: "unknown", sourcePart: 3, sourceIndex: 0 }
        ], { conversationKey: "c" });
        const messages = result.messages.filter((m) => m.type === "msg");
        assert.deepEqual(messages.map((m) => m.text), ["dated", "first", "second"]);
        assert.equal(messages[1].rawTime, "unknown");
        assert.equal(messages[1].time, "unknown");
    });

    test("available relative media and missing attachments use the existing media item shape", () => {
        const result = normalizeMessages([{
            sender: "A", text: "files", rawTime: "11/12/2017, 21:48", htmlPath: "messages/inbox/one_123/message_1.html",
            attachmentRefs: [{ ref: "photos/shared.jpg" }, { ref: "photos/not-here.png" }]
        }], { conversationKey: "messages/inbox/one_123", entries });
        const msg = result.messages.find((item) => item.type === "msg");
        assert.equal(msg.mediaItems[0].status, "available");
        assert.equal(msg.mediaItems[0].kind, "image");
        assert.deepEqual({ status: msg.mediaItems[1].status, name: msg.mediaItems[1].name }, { status: "missing", name: "not-here.png" });
    });

    test("normalizes ZIP separators and parent-relative paths", () => {
        assert.equal(normalizeZipPath("messages\\inbox\\one\\..\\photo.jpg"), "messages/inbox/photo.jpg");
    });
});
