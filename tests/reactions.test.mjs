import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

// Viewer modules look elements up by id; in Node there are none.
globalThis.document ??= {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    createElement: () => ({ style: {}, click() {} }),
    body: { classList: { toggle() {}, contains: () => false }, appendChild() {}, removeChild() {} }
};
globalThis.window ??= globalThis;

const {
    MAX_REACTION_GRAPHEMES,
    UNKNOWN_ACTOR,
    describeReactionGroup,
    displayReaction,
    groupReactions,
    normalizeReactions,
    reactionKey
} = await versioned("../js/shared/reactions.js");
const { parseMessages } = await versioned("../js/instagram/parser.js");
const { igState } = await versioned("../js/instagram/state.js");
const { collectExportMessages } = await versioned("../js/instagram/render.js");
const { display } = await versioned("../js/instagram/anonymize.js");
const { exportChatAsHTML } = await versioned("../js/export.js");

const mangle = (text) => Buffer.from(text, "utf8").toString("latin1");

// ── Normalisation ───────────────────────────────────────────────────────────

describe("reactionKey", () => {
    test("❤, ❤️ and ❤︎ are one key", () => {
        assert.equal(reactionKey("❤"), "❤");
        assert.equal(reactionKey("❤️"), "❤");
        assert.equal(reactionKey("❤︎"), "❤");
        assert.equal(reactionKey("☺️"), reactionKey("☺"));
    });

    test("drops invisible marks, spaces and stray joiners at the edges", () => {
        assert.equal(reactionKey(" ​😂‎ "), "😂");
        assert.equal(reactionKey("⁦🔥⁩"), "🔥");
        assert.equal(reactionKey("﻿👍"), "👍");
        assert.equal(reactionKey("‍😮‍"), "😮");
    });

    test("keeps what makes emojis different: skin tones, ZWJ sequences, flags, keycaps", () => {
        assert.notEqual(reactionKey("👍🏽"), reactionKey("👍"));
        assert.equal(reactionKey("👍🏽"), "👍🏽");
        assert.equal(reactionKey("👨‍👩‍👧"), "👨‍👩‍👧");
        assert.notEqual(reactionKey("👨‍👩‍👧"), reactionKey("👨👩👧"));
        assert.equal(reactionKey("🇮🇳"), "🇮🇳");
        assert.equal(reactionKey("1️⃣"), "1⃣");
    });

    test("NFC: composed and decomposed text match", () => {
        assert.equal(reactionKey("é"), reactionKey("é"));
    });

    test("not a string, or nothing visible → empty", () => {
        for (const value of [undefined, null, 5, {}, [], true, "", "   ", "️", "​‍"]) {
            assert.equal(reactionKey(value), "", JSON.stringify(value));
        }
    });
});

describe("displayReaction", () => {
    test("asks for the colour emoji where the bare character is text-style", () => {
        assert.equal(displayReaction("❤"), "❤️");
        assert.equal(displayReaction("😂"), "😂");
        assert.equal(displayReaction("👍🏽"), "👍🏽");
    });

    test("anything long is cut to a few characters (it is still escaped by the renderer)", () => {
        const shown = displayReaction("<img src=x onerror=alert(1)>");
        assert.equal(shown, "<img…");
        assert.equal([...displayReaction("👨‍👩‍👧".repeat(10))].filter((c) => c === "…").length, 1);
        assert.ok(displayReaction("x".repeat(100000)).length <= MAX_REACTION_GRAPHEMES + 1);
    });
});

// ── One per person ──────────────────────────────────────────────────────────

describe("normalizeReactions", () => {
    test("missing, empty or malformed input gives no reactions", () => {
        assert.deepEqual(normalizeReactions(undefined), []);
        assert.deepEqual(normalizeReactions({}), []);
        assert.deepEqual(normalizeReactions([null, 7, "❤", [], { actor: "Bob" }, { reaction: "", actor: "Bob" }, { reaction: 5, actor: "Bob" }]), []);
    });

    test("the same person reacting twice counts once — their latest", () => {
        const kept = normalizeReactions([
            { reaction: "❤", actor: "Bob", timestamp: 10 },
            { reaction: "😂", actor: "Zoë", timestamp: 10 },
            { reaction: "❤️", actor: "Bob", timestamp: 10 },
            { reaction: "😮", actor: "Zoë", timestamp: 5 },
            { reaction: "🔥", actor: "Ann", timestamp_ms: 1 },
            { reaction: "👍", actor: "Ann", timestamp_ms: 2 }
        ]);
        assert.deepEqual(kept.map(({ reaction, actor }) => `${actor}:${reaction}`), ["Zoë:😂", "Bob:❤", "Ann:👍"]);
    });

    test("reactions without an actor are each kept", () => {
        const kept = normalizeReactions([{ reaction: "👍" }, { reaction: "👍", actor: "" }, { reaction: "👍", actor: "   " }]);
        assert.equal(kept.length, 3);
        assert.ok(kept.every((entry) => entry.actor === ""));
    });
});

// ── Grouping ────────────────────────────────────────────────────────────────

describe("groupReactions", () => {
    test("groups ❤ with ❤️, counts, most-used first, ties in order of appearance", () => {
        const groups = groupReactions([
            { reaction: "😂", actor: "A" },
            { reaction: "❤", actor: "B" },
            { reaction: "❤️", actor: "C" },
            { reaction: "🔥", actor: "D" }
        ]);
        assert.deepEqual(groups.map((g) => [g.emoji, g.count, g.actors.join("+")]), [["❤️", 2, "B+C"], ["😂", 1, "A"], ["🔥", 1, "D"]]);
    });

    test("names go through nameFor; a missing actor is 'Someone'", () => {
        const groups = groupReactions([{ reaction: "👍", actor: "Bob Jones" }, { reaction: "👍" }], (name) => `alias(${name})`);
        assert.deepEqual(groups[0].actors, ["alias(Bob Jones)", UNKNOWN_ACTOR]);
    });

    test("many different reactions each get a group", () => {
        const emojis = [..."😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫"];
        const groups = groupReactions(emojis.map((reaction, i) => ({ reaction, actor: `P${i}` })));
        assert.equal(groups.length, emojis.length);
    });

    test("stays fast for a huge group's reactions", () => {
        const list = Array.from({ length: 100000 }, (_, i) => ({ reaction: ["❤", "❤️", "😂", "👍🏽"][i % 4], actor: `P${i}` }));
        const started = performance.now();
        const groups = groupReactions(list);
        assert.equal(groups.length, 3);
        assert.equal(groups[0].count, 50000);
        assert.ok(performance.now() - started < 1000);
    });

    test("describeReactionGroup reads naturally", () => {
        assert.equal(describeReactionGroup({ emoji: "❤️", count: 1, actors: ["Bob"] }), "❤️ 1 reaction: Bob");
        assert.equal(describeReactionGroup({ emoji: "❤️", count: 2, actors: ["Bob", "Zoë"] }), "❤️ 2 reactions: Bob and Zoë");
        assert.equal(describeReactionGroup({ emoji: "👍", count: 8, actors: ["A", "B", "C", "D", "E", "F", "G", "H"] }), "👍 8 reactions: A, B, C, D, E and 3 more");
    });
});

// ── Through the parser ──────────────────────────────────────────────────────

function resetIg() {
    igState.messages = [];
    igState.filteredMessages = [];
    igState.messageOnlyCount = 0;
    igState.myName = "Me";
    igState.chatTitle = "Bob Jones";
    igState.participants = ["Bob Jones", "Zoë Ångström"];
    igState.senderStats = {};
    igState.emojiStats = {};
    igState.hourlyStats = Array(24).fill(0);
    igState.mediaCount = 0;
    igState.mediaMissingCount = 0;
    igState.mediaStore.clear();
    igState.mediaLookup.clear();
}

describe("instagram parser: reactions", () => {
    beforeEach(resetIg);

    test("emoji and actor names get the mojibake repair", () => {
        parseMessages([{ sender_name: "Bob Jones", timestamp_ms: 1, content: "hi", reactions: [{ reaction: mangle("❤️"), actor: mangle("Zoë Ångström"), timestamp: 1 }, { reaction: mangle("🙏🏽"), actor: mangle("Bob Jones"), timestamp: 2 }] }]);
        const message = igState.messages.find((item) => item.type === "msg");
        assert.deepEqual(message.reactions.map(({ reaction, actor }) => [reaction, actor]), [["❤", "Zoë Ångström"], ["🙏🏽", "Bob Jones"]]);
    });

    test("malformed entries are dropped, the message kept; non-strings never become text", () => {
        parseMessages([{ sender_name: "Bob Jones", timestamp_ms: 1, content: "hi", reactions: [null, { reaction: null, actor: "x" }, { actor: "Nobody" }, { reaction: { evil: 1 }, actor: "x" }, { reaction: "👍", actor: 42 }] }]);
        const message = igState.messages.find((item) => item.type === "msg");
        assert.deepEqual(message.reactions.map(({ reaction, actor }) => [reaction, actor]), [["👍", ""]]);
        assert.doesNotMatch(JSON.stringify(message.reactions), /object Object/);
    });

    test("a message with only reactions still shows; reactions: 'x' or {} is ignored", () => {
        parseMessages([
            { sender_name: "Bob Jones", timestamp_ms: 1, reactions: [{ reaction: "😮", actor: "Zoë Ångström" }] },
            { sender_name: "Bob Jones", timestamp_ms: 2, content: "a", reactions: "x" },
            { sender_name: "Bob Jones", timestamp_ms: 3, content: "b", reactions: {} }
        ]);
        const messages = igState.messages.filter((item) => item.type === "msg");
        assert.equal(messages.length, 3);
        assert.equal(messages[0].reactions.length, 1);
        assert.equal(messages[1].reactions.length + messages[2].reactions.length, 0);
    });
});

// ── Export ──────────────────────────────────────────────────────────────────

async function captureExport(options) {
    const createObjectURL = URL.createObjectURL;
    const originalSetTimeout = globalThis.setTimeout;
    let blob;
    URL.createObjectURL = (value) => { blob = value; return "blob:test"; };
    globalThis.setTimeout = (callback) => { callback(); return 0; };
    try {
        await exportChatAsHTML(options);
        return await blob.text();
    } finally {
        URL.createObjectURL = createObjectURL;
        globalThis.setTimeout = originalSetTimeout;
    }
}

describe("export: reactions with who reacted", () => {
    const EVIL = `<img src=x onerror=alert(1)>"'&`;
    async function exportThread(anonymize) {
        resetIg();
        parseMessages([{
            sender_name: "Bob Jones", timestamp_ms: 1, content: "trip?",
            reactions: [
                { reaction: "❤", actor: "Zoë Ångström", timestamp: 1 },
                { reaction: "❤️", actor: "Bob Jones", timestamp: 1 },
                { reaction: `<script>alert(2)</script>`, actor: EVIL, timestamp: 1 },
                { reaction: "😂" }
            ]
        }]);
        display.setOn(anonymize);
        try {
            return await captureExport({ theme: "instagram", title: "t", messageCount: 1, messages: collectExportMessages() });
        } finally {
            display.setOn(false);
        }
    }

    test("pills grouped (❤ + ❤️ = 2) with a no-script list of who reacted", async () => {
        const html = await exportThread(false);
        assert.match(html, /<details class="ce-reactions"><summary[^>]*>/);
        assert.match(html, /❤️ <small>2<\/small>/);
        assert.match(html, /<bdi>Zoë Ångström<\/bdi>, <bdi>Bob Jones<\/bdi>/);
        assert.match(html, /<bdi>Someone<\/bdi>/);
    });

    test("injection in emoji or actor stays inert text", async () => {
        const html = await exportThread(false);
        assert.doesNotMatch(html, /<img src=x/);
        assert.doesNotMatch(html, /<script>alert/);
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
        assert.match(html, /&lt;scr…/);
    });

    test("Anonymize: actors are aliases in pills, tooltips and the list", async () => {
        const html = await exportThread(true);
        assert.doesNotMatch(html, /Zoë|Ångström|Bob|Jones|onerror/);
        assert.match(html, /<bdi>Person [A-Z]<\/bdi>, <bdi>Person [A-Z]<\/bdi>/);
        assert.match(html, /title="❤️ 2 reactions: Person [A-Z] and Person [A-Z]"/);
    });
});
