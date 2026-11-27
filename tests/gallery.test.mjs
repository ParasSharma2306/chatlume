import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

// Viewer modules look elements up by id; in Node there are none.
globalThis.document ??= {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
    createElement: () => ({ style: {}, click() {} }),
    body: { classList: { toggle() {}, contains: () => false }, appendChild() {}, removeChild() {} }
};
globalThis.window ??= globalThis;

const { audioMimeFor, detectMediaType } = await versioned("../js/shared/media-types.js");
const { attachmentKindOf, collectGallery, galleryTabOf, OMITTED_MEDIA_NAME } = await versioned("../js/shared/gallery-model.js");
const { buildMaskedRichText, buildRichText, extractLinks, hostOf, maskTextForSharing, maskUrlLabel, splitLinks } = await versioned("../js/shared/text.js");
const { escapeHtml } = await versioned("../js/shared/dom.js");
const { createAnonymizer } = await versioned("../js/shared/anonymize.js");
const { applyKindHint, buildMediaStore, parseMessages, shareKindOf } = await versioned("../js/instagram/parser.js");
const { igState } = await versioned("../js/instagram/state.js");

const mangle = (text) => Buffer.from(text, "utf8").toString("latin1");

// ── Voice-note classification (the prerequisite fix) ───────────────────────

describe("media classification: voice notes", () => {
    test("an audio hint turns an .mp4 into audio/mp4, not video", () => {
        assert.deepEqual(detectMediaType("1234.mp4", { stickers: false, hint: "audio" }), { kind: "audio", mime: "audio/mp4", ext: "mp4" });
        assert.equal(detectMediaType("clip.3gp", { hint: "audio" }).mime, "audio/3gpp");
        assert.equal(detectMediaType("clip.webm", { hint: "audio" }).mime, "audio/webm");
    });

    test("without a hint an .mp4 is still a video", () => {
        assert.equal(detectMediaType("1234.mp4", { stickers: false }).kind, "video");
        assert.equal(detectMediaType("VID-20240101-WA0001.mp4").kind, "video");
    });

    test("an audio hint never turns a picture into audio", () => {
        assert.equal(detectMediaType("cover.jpg", { hint: "audio" }).kind, "image");
    });

    test("WhatsApp voice notes and audio stay audio in every container", () => {
        for (const name of ["PTT-20240101-WA0001.opus", "PTT-20240101-WA0002.ogg", "AUD-20240101-WA0003.m4a", "AUD-20240101-WA0004.aac", "AUD-20240101-WA0005.mp3", "00000012-AUDIO-2024-01-01-10-00-00.opus"]) {
            assert.equal(detectMediaType(name).kind, "audio", name);
        }
        assert.deepEqual(detectMediaType("PTT-20240101-WA0006.mp4"), { kind: "audio", mime: "audio/mp4", ext: "mp4" });
        assert.equal(detectMediaType("AUD-20240101-WA0007.3gp").kind, "audio");
        assert.equal(detectMediaType("00000013-AUDIO-2024-01-01-10-00-00.m4a").mime, "audio/mp4");
        assert.equal(detectMediaType("voice.ogg").mime, "audio/ogg");
        assert.equal(detectMediaType("voice.opus").mime, "audio/ogg");
        assert.equal(detectMediaType("voice.m4a").mime, "audio/mp4");
    });

    test("audioMimeFor covers audio and video containers", () => {
        assert.equal(audioMimeFor("opus"), "audio/ogg");
        assert.equal(audioMimeFor("mp4"), "audio/mp4");
        assert.equal(audioMimeFor("xyz"), "audio/mp4");
    });
});

function resetIg() {
    igState.messages = [];
    igState.filteredMessages = [];
    igState.messageOnlyCount = 0;
    igState.myName = "Me";
    igState.senderStats = {};
    igState.emojiStats = {};
    igState.hourlyStats = Array(24).fill(0);
    igState.mediaCount = 0;
    igState.mediaMissingCount = 0;
    igState.renderRange = { start: 0, end: 0 };
    igState.mediaStore.clear();
    igState.mediaLookup.clear();
}

describe("instagram parser: audio_files", () => {
    beforeEach(resetIg);
    const entry = (filename) => ({ filename, directory: false, getData: async () => new Blob() });

    test("voice notes listed in audio_files are audio, in the message and in the store", () => {
        buildMediaStore([
            entry("your_instagram_activity/messages/inbox/bob_1/audio/111.mp4"),
            entry("your_instagram_activity/messages/inbox/bob_1/videos/222.mp4")
        ]);
        parseMessages([
            { sender_name: "Bob", timestamp_ms: 1000, audio_files: [{ uri: "your_instagram_activity/messages/inbox/bob_1/audio/111.mp4" }] },
            { sender_name: "Bob", timestamp_ms: 2000, videos: [{ uri: "your_instagram_activity/messages/inbox/bob_1/videos/222.mp4" }] },
            { sender_name: "Bob", timestamp_ms: 3000, audio_files: [{ uri: "your_instagram_activity/messages/inbox/bob_1/audio/missing.mp4" }] }
        ]);
        const [voice, video, missing] = igState.messages.filter((item) => item.type === "msg").map((item) => item.mediaItems[0]);
        assert.equal(voice.kind, "audio");
        assert.equal(voice.mime, "audio/mp4");
        assert.equal(igState.mediaStore.get(voice.id).kind, "audio", "the store record the player reads is audio too");
        assert.equal(igState.mediaStore.get(voice.id).mime, "audio/mp4");
        assert.equal(video.kind, "video");
        assert.equal(missing.status, "missing");
        assert.equal(missing.kind, "audio");
    });

    test("applyKindHint leaves other hints and audio records alone", () => {
        const record = { name: "a.mp4", kind: "video", mime: "video/mp4" };
        applyKindHint(record, "video");
        assert.equal(record.kind, "video");
        applyKindHint(record, "audio");
        assert.equal(record.kind, "audio");
        assert.equal(applyKindHint(null, "audio"), null);
    });

    test("shared posts keep their owner handle, repaired like message text", () => {
        parseMessages([{ sender_name: "Bob", timestamp_ms: 1, share: { link: "https://www.instagram.com/reel/ABC/", share_text: mangle("Zoë's trip ✈️"), original_content_owner: mangle("@zoë.trips") } }]);
        const message = igState.messages.find((item) => item.type === "msg");
        assert.equal(message.shareOwner, "zoë.trips");
        assert.equal(message.shareText, "Zoë's trip ✈️");
    });
});

describe("instagram shareKindOf", () => {
    test("recognises reels, posts, IGTV and stories on instagram.com only", () => {
        assert.equal(shareKindOf("https://www.instagram.com/reel/ABC123/?igsh=xyz"), "reel");
        assert.equal(shareKindOf("https://instagram.com/reels/ABC123"), "reel");
        assert.equal(shareKindOf("https://www.instagram.com/p/ABC123/"), "post");
        assert.equal(shareKindOf("https://www.instagram.com/tv/ABC123/"), "video");
        assert.equal(shareKindOf("https://www.instagram.com/stories/someone/123/"), "story");
        assert.equal(shareKindOf("https://www.instagram.com/someone/"), "");
        assert.equal(shareKindOf("https://www.instagram.com/reel/"), "");
        assert.equal(shareKindOf("https://evil.example/instagram.com/reel/ABC"), "");
        assert.equal(shareKindOf("https://instagram.com.evil.example/reel/ABC"), "");
        assert.equal(shareKindOf("javascript:alert(1)//instagram.com/reel/x"), "");
        assert.equal(shareKindOf(""), "");
        assert.equal(shareKindOf(null), "");
    });
});

// ── Gallery model ───────────────────────────────────────────────────────────

const msg = (id, sender, extra = {}) => ({ type: "msg", id, sender, text: "", mediaItems: [], ...extra });
const media = (id, name, kind, status = "available") => ({ id, name, kind, status });

describe("gallery model", () => {
    test("sorts attachments into media and docs, newest first, and skips stickers", () => {
        const day1 = { type: "date", id: "d1", content: "15/01/2024" };
        const day2 = { type: "date", id: "d2", content: "16/01/2024" };
        const data = collectGallery([
            day1,
            msg("m1", "Alice", { mediaItems: [media("a", "IMG-1.jpg", "image"), media("b", "VID-1.mp4", "video")] }),
            { type: "system", id: "s1", content: "Alice added Bob https://not-a-message.example" },
            day2,
            msg("m2", "Bob", { mediaItems: [media("c", "PTT-1.opus", "audio"), media("d", "Trip.pdf", "document"), media("e", "STK-1.webp", "sticker"), media("f", "Bob.vcf", "contact"), media("g", "x.zip", "archive")] })
        ]);
        assert.deepEqual(data.media.map((item) => item.mediaId), ["b", "a"]);
        assert.deepEqual(data.media.map((item) => item.kind), ["video", "image"]);
        assert.deepEqual(data.docs.map((item) => item.mediaId), ["g", "f", "d", "c"]);
        assert.equal(data.docs.find((item) => item.mediaId === "c").kind, "audio");
        assert.equal(data.media[0].day, day1, "remembers the day marker it sat under");
        assert.equal(data.docs[0].day, day2);
        assert.equal(data.media[0].messageId, "m1");
        assert.equal(data.links.length, 0, "system lines are not messages");
    });

    test("counts <Media omitted> and missing files instead of listing them", () => {
        const data = collectGallery([
            msg("m1", "A", { mediaItems: [media("x1", OMITTED_MEDIA_NAME, "missing", "missing")] }),
            msg("m2", "A", { mediaItems: [media("x2", OMITTED_MEDIA_NAME, "missing", "missing")] }),
            msg("m3", "A", { mediaItems: [media("x3", "IMG-20240199-WA9999.jpg", "missing", "missing")] }),
            msg("m4", "A", { mediaItems: [media("x4", "PTT-20240101-WA0001.opus", "missing", "missing")] }),
            msg("m5", "A", { mediaItems: [media("x5", "missing.mp4", "audio", "missing")] })
        ]);
        assert.equal(data.omitted, 2);
        assert.deepEqual(data.missing, { media: 1, docs: 2 });
        assert.equal(data.media.length + data.docs.length, 0);
    });

    test("finds links in text, uses a shared post's caption, and dedupes per message", () => {
        const data = collectGallery([
            msg("m1", "A", { text: "see https://example.com/a. and (https://example.com/b) and https://example.com/a" }),
            msg("m2", "B", { text: "no links here, just http and www.example.com" }),
            msg("m3", "C", { text: "check this https://www.instagram.com/p/X/", shareLink: "https://www.instagram.com/p/X/", shareText: "A trip" }),
            msg("m4", "D", { shareLink: "javascript:alert(1)", shareText: "evil" })
        ]);
        assert.deepEqual(data.links.map((link) => [link.messageId, link.url, link.label]), [
            ["m3", "https://www.instagram.com/p/X/", "A trip"],
            ["m1", "https://example.com/b", ""],
            ["m1", "https://example.com/a", ""]
        ]);
    });

    test("never throws on malformed input", () => {
        assert.deepEqual(collectGallery(null).media, []);
        const data = collectGallery([null, 7, "x", {}, { type: "msg" }, { type: "msg", id: "a", mediaItems: [null, {}], text: 42 }]);
        assert.equal(data.media.length + data.links.length + data.docs.length, 0);
    });

    test("tab for an attachment, including missing ones classified by name", () => {
        assert.equal(galleryTabOf(media("1", "a.jpg", "image")), "media");
        assert.equal(galleryTabOf(media("1", "a.webp", "sticker")), null);
        assert.equal(galleryTabOf(media("1", "IMG-1.jpg", "missing")), "media");
        assert.equal(galleryTabOf(media("1", "PTT-1.opus", "missing")), "docs");
        assert.equal(attachmentKindOf(null), "");
    });

    test("stays fast on a 60,000-message chat", () => {
        const messages = [];
        for (let i = 0; i < 60000; i += 1) {
            if (i % 2000 === 0) messages.push({ type: "date", id: `d${i}`, content: `day ${i}` });
            const r = i % 50;
            messages.push(msg(`m${i}`, `P${i % 30}`, {
                text: r === 0 ? `link https://example.com/p/${i}` : `message ${i} lorem ipsum`,
                mediaItems: r === 1 ? [media(`i${i}`, `IMG-${i}.jpg`, "image")] : r === 2 ? [media(`v${i}`, `PTT-${i}.opus`, "audio")] : []
            }));
        }
        const started = performance.now();
        const data = collectGallery(messages);
        const elapsed = performance.now() - started;
        assert.equal(data.links.length, 1200);
        assert.equal(data.media.length, 1200);
        assert.equal(data.docs.length, 1200);
        assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms`);
    });
});

// ── Links in Anonymize mode ─────────────────────────────────────────────────

describe("masked rich text keeps real link targets", () => {
    const anonymizer = createAnonymizer({ names: ["Alice Smith", "+91 98765 43210", "محمد علي"] });
    const mask = anonymizer.text;

    test("a name or number inside a URL is masked in the text, never in the href", () => {
        const raw = "Alice Smith shared https://example.com/u/Alice%20Smith/12345678901 and https://example.com/Alice";
        const html = buildMaskedRichText(raw, { mask });
        const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
        assert.deepEqual(hrefs, ["https://example.com/u/Alice%20Smith/12345678901", "https://example.com/Alice"]);
        const visible = html.replace(/<a [^>]*>/g, "<a>");
        assert.doesNotMatch(visible, /Alice|Smith|12345678901/);
        assert.match(visible, /^Person A shared <a>/);
    });

    test("one link stays one link even when masking adds spaces", () => {
        const html = buildMaskedRichText("https://example.com/Alice/Smith?x=1", { mask });
        assert.equal((html.match(/<a /g) || []).length, 1);
        assert.match(html, /href="https:\/\/example\.com\/Alice\/Smith\?x=1"/);
    });

    test("RTL names are masked outside links too", () => {
        const html = buildMaskedRichText("مرحبا محمد علي https://example.com/x", { mask });
        assert.doesNotMatch(html.replace(/href="[^"]*"/g, ""), /محمد/);
    });

    test("injection attempts stay inert in text and in href", () => {
        const raw = `"><script>alert(1)</script> https://evil.example.com/"onmouseover=alert(1)><img src=x onerror=alert(2)> javascript:alert(3)`;
        const html = buildMaskedRichText(raw, { mask });
        assert.doesNotMatch(html, /<script|<img|onmouseover="|href="javascript/i);
        assert.equal((html.match(/<a /g) || []).length, 1);
        assert.match(html, /href="https:\/\/evil\.example\.com\/&quot;onmouseover=alert\(1\)&gt;&lt;img"/);
    });

    test("with no mask it is byte-for-byte the normal linkifier", () => {
        const samples = [
            "plain", "see https://x.y/a.", "(https://x.y/a_(b))", "*bold* https://x.y/_c_ _it_", "a & b < c > d \"e\" 'f'",
            "https://x.y/?a=1&b=2;", "https://x.y/a'b\"c", "~s~ `code` ```block```", "مرحبا https://example.com/عربي שלום", "😀👍🏽 https://x.y/😀"
        ];
        for (const formatting of [true, false]) {
            for (const raw of samples) {
                assert.equal(buildMaskedRichText(raw, { formatting }), buildRichText(escapeHtml(raw), { formatting }), raw);
            }
        }
    });

    test("URL labels: percent-escapes decoded, _ separates words, untouched when nothing to hide", () => {
        assert.equal(maskUrlLabel("https://example.com/u/Alice%20Smith", mask), "https://example.com/u/Person A");
        assert.match(maskUrlLabel("https://example.com/Alice_Smith", anonymizer.fileName), /^https:\/\/example\.com\/Person A_Person A$/);
        assert.equal(maskUrlLabel("https://example.com/a%20b", mask), "https://example.com/a%20b");
        assert.equal(maskUrlLabel("https://example.com/%E0%A4%A", mask), "https://example.com/%E0%A4%A");
    });

    test("text for sharing: masked links stay text, clean links stay links", () => {
        const shared = maskTextForSharing("Alice Smith: https://example.com/u/Alice_Smith and https://example.com/ok", { mask, maskUrl: anonymizer.fileName });
        assert.doesNotMatch(shared, /Alice|Smith/);
        const html = buildRichText(escapeHtml(shared));
        assert.deepEqual([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]), ["https://example.com/ok"]);
        assert.match(html, /example\.com\/u\/Person A/);
    });

    test("splitLinks / extractLinks / hostOf", () => {
        assert.deepEqual(splitLinks("a https://x.y/b, c"), [{ text: "a ", url: false }, { text: "https://x.y/b", url: true }, { text: ", c", url: false }]);
        assert.deepEqual(extractLinks("https:// nothing, http://a.b/c!"), ["http://a.b/c"]);
        assert.deepEqual(extractLinks(""), []);
        assert.deepEqual(extractLinks(undefined), []);
        assert.equal(hostOf("https://www.example.com/a"), "example.com");
        assert.equal(hostOf("not a url"), "");
    });

    test("pathological input stays linear", () => {
        const raw = "https://" + "a(".repeat(20000) + " " + ")".repeat(20000) + " x".repeat(20000);
        const started = performance.now();
        buildMaskedRichText(raw, { mask });
        extractLinks(raw);
        assert.ok(performance.now() - started < 1500);
    });
});
