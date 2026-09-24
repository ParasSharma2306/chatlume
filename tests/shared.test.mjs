import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const { escapeAttribute, escapeHtml, escapeRegExp } = await versioned("../js/shared/dom.js");
const { applyTextFormatting, buildRichText, highlightOutsideTags } = await versioned("../js/shared/text.js");
const { baseName, detectMediaType, formatBytes, inferMimeType, labelForMediaKind } = await versioned("../js/shared/media-types.js");
const { SENDER_COLORS, colorForName } = await versioned("../js/shared/colors.js");
const { countEmojis } = await versioned("../js/shared/emoji.js");
const { clampRenderRange, syncScrollLatestButton, tailRange } = await versioned("../js/shared/virtual-list.js");

/**
 * The utilities both viewers share. These used to be duplicated (with small
 * drifts) in script.js and instagram.js; now there is one copy, and it is
 * pinned here.
 */

describe("shared/dom escaping", () => {
    test("escapeHtml neutralises every HTML-significant character", () => {
        assert.equal(escapeHtml(`<a href="x">it's & more</a>`), "&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; more&lt;/a&gt;");
    });

    test("escapeAttribute also neutralises backticks", () => {
        assert.equal(escapeAttribute("`x`"), "&#96;x&#96;");
    });

    test("escapeRegExp makes a literal pattern", () => {
        assert.equal(new RegExp(escapeRegExp("a.b*c?")).test("a.b*c?"), true);
        assert.equal(new RegExp(escapeRegExp("a.b*c?")).test("aXbc"), false);
    });
});

describe("shared/text", () => {
    test("applies WhatsApp *bold* _italic_ ~strike~ markers", () => {
        assert.equal(applyTextFormatting("*b* _i_ ~s~"), "<strong>b</strong> <em>i</em> <s>s</s>");
    });

    test("linkifies URLs without letting formatting rewrite the href", () => {
        const html = buildRichText("see https://example.com/Foo_bar_baz _now_");
        assert.match(html, /href="https:\/\/example\.com\/Foo_bar_baz"/);
        assert.match(html, /<em>now<\/em>/);
        assert.doesNotMatch(html, /Foo<em>/);
    });

    test("formatting can be switched off (Instagram has no markers)", () => {
        assert.equal(buildRichText("*not bold* https://x.y", { formatting: false }),
            '*not bold* <a href="https://x.y" target="_blank" rel="noopener noreferrer">https://x.y</a>');
    });

    test("highlightOutsideTags never touches attributes", () => {
        const html = highlightOutsideTags('<a href="http://a">http://a</a>', "http");
        assert.equal(html, '<a href="http://a"><span class="hl">http</span>://a</a>');
    });

    test("highlight is case-insensitive and regex-safe", () => {
        assert.equal(highlightOutsideTags("A.b a.B", "a.b"), '<span class="hl">A.b</span> <span class="hl">a.B</span>');
        assert.equal(highlightOutsideTags("axb", "a.b"), "axb");
    });
});

describe("shared/media-types", () => {
    test("voice-note extensions are always audio, whatever the MIME says", () => {
        assert.deepEqual(detectMediaType("PTT-1.opus"), { kind: "audio", mime: "audio/ogg", ext: "opus" });
        assert.equal(detectMediaType("clip.m4a", { mimeType: "video/mp4" }).kind, "audio");
        assert.equal(detectMediaType("song.flac").mime, "audio/flac");
    });

    test("WhatsApp stickers are detected by extension or STK- prefix", () => {
        assert.equal(detectMediaType("STK-20240101-WA0001.webp").kind, "sticker");
        assert.equal(detectMediaType("photo.webp").kind, "sticker");
        assert.equal(detectMediaType("IMG-1.jpg").kind, "image");
    });

    test("Instagram opts out of sticker detection so .webp photos stay images", () => {
        assert.equal(detectMediaType("photo.webp", { stickers: false }).kind, "image");
        assert.equal(detectMediaType("STK-1.webp", { stickers: false }).kind, "image");
    });

    test("documents, archives and contacts get their own kinds", () => {
        assert.equal(detectMediaType("notes.pdf").kind, "document");
        assert.equal(detectMediaType("backup.zip").kind, "archive");
        assert.equal(detectMediaType("me.vcf").kind, "contact");
        assert.equal(detectMediaType("whatever.xyz").kind, "document");
        assert.equal(detectMediaType("clip.mov").kind, "video");
    });

    test("inferMimeType falls back to octet-stream", () => {
        assert.equal(inferMimeType("png"), "image/png");
        assert.equal(inferMimeType("nope"), "application/octet-stream");
    });

    test("labelForMediaKind and formatBytes", () => {
        assert.equal(labelForMediaKind("sticker"), "Sticker");
        assert.equal(labelForMediaKind("missing"), "File");
        assert.equal(formatBytes(0), "");
        assert.equal(formatBytes(512), "512 B");
        assert.equal(formatBytes(1536), "1.5 KB");
        assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
        assert.equal(formatBytes(3 * 1024 ** 4), "3072 GB");
    });

    test("baseName takes the last path segment", () => {
        assert.equal(baseName("messages/inbox/x/photos/a.jpg"), "a.jpg");
        assert.equal(baseName(""), "");
    });
});

describe("shared/colors", () => {
    test("colours are stable per name and memoised", () => {
        const map = {};
        const first = colorForName("Alice", map);
        assert.ok(SENDER_COLORS.includes(first));
        assert.equal(colorForName("Alice", map), first);
        assert.equal(colorForName("Alice", {}), first);
        assert.equal(Object.keys(map).length, 1);
    });
});

describe("shared/emoji", () => {
    test("counts emojis into the tally", () => {
        const stats = {};
        countEmojis("hi 😀😀 🎉 no emoji here", stats);
        countEmojis("😀", stats);
        assert.deepEqual(stats, { "😀": 3, "🎉": 1 });
    });
});

describe("shared/virtual-list", () => {
    test("tailRange shows the newest window", () => {
        assert.deepEqual(tailRange(1000, 180), { start: 820, end: 1000 });
        assert.deepEqual(tailRange(50, 180), { start: 0, end: 50 });
    });

    test("clampRenderRange keeps the window inside the list and under the cap", () => {
        const state = { filteredMessages: new Array(100), renderRange: { start: -5, end: 500 } };
        clampRenderRange(state, 30);
        assert.deepEqual(state.renderRange, { start: 70, end: 100 });

        state.renderRange = { start: 90, end: 20 };
        clampRenderRange(state, 30);
        assert.deepEqual(state.renderRange, { start: 90, end: 90 });
    });

    test("does not show jump-to-latest from a stale animation frame", () => {
        const originalRaf = globalThis.requestAnimationFrame;
        const originalWindow = globalThis.window;
        const frames = [];
        globalThis.requestAnimationFrame = (callback) => frames.push(callback);
        globalThis.window = { setTimeout: () => 0 };
        const classes = new Set();
        const button = {
            hidden: true,
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name)
            }
        };
        const viewport = { scrollHeight: 1000, scrollTop: 300, clientHeight: 300 };
        const state = { filteredMessages: new Array(10), renderRange: { start: 0, end: 10 } };

        try {
            syncScrollLatestButton(button, viewport, state);
            syncScrollLatestButton(button, viewport, state);
            assert.equal(frames.length, 1);
            viewport.scrollTop = 700;
            syncScrollLatestButton(button, viewport, state);
            frames.forEach((callback) => callback());
            assert.equal(classes.has("show"), false);
        } finally {
            if (originalRaf) globalThis.requestAnimationFrame = originalRaf;
            else delete globalThis.requestAnimationFrame;
            if (originalWindow) globalThis.window = originalWindow;
            else delete globalThis.window;
        }
    });
});
