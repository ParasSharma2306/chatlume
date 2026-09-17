import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const { fixMojibake } = await versioned("../js/instagram/mojibake.js");
const { findThreads, folderLabel, initialsFor, normalizeKey, sortMessageFiles } = await versioned("../js/instagram/parser.js");

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
});
