import assert from "node:assert/strict";
import test from "node:test";

import {
    extractWhatsAppDatePart,
    extractWhatsAppTimePart,
    parseWhatsAppDateLabel,
    parseWhatsAppLine,
    stripWhatsAppDirectionControls
} from "../js/whatsapp-parser.js";

test("parses recent iOS exports containing a Persian calendar era", () => {
    const parsed = parseWhatsAppLine("\u200e[6/11/1405 AP, 7:41:05\u202fAM] Nami PSG: سلام");

    assert.deepEqual(
        { type: parsed.type, rawTime: parsed.rawTime, sender: parsed.sender, content: parsed.content },
        { type: "message", rawTime: "6/11/1405 AP, 7:41:05\u202fAM", sender: "Nami PSG", content: "سلام" }
    );
    assert.equal(extractWhatsAppDatePart(parsed.rawTime), "6/11/1405 AP");
    assert.equal(extractWhatsAppTimePart(parsed.rawTime), "7:41:05\u202fAM");
});

test("continues to parse established Android and iOS timestamp formats", () => {
    assert.equal(parseWhatsAppLine("6/2/23, 14:00 - Alex: Hello").type, "message");
    assert.equal(parseWhatsAppLine("[6/2/23, 2:00:01 PM] Alex: Hello").type, "message");
    const dotted = parseWhatsAppLine("[14/12/2022, 12.55.37] Alex: Hello");
    assert.equal(dotted.type, "message");
    assert.equal(extractWhatsAppTimePart(dotted.rawTime), "12.55.37");
    assert.equal(parseWhatsAppLine("continuation text"), null);
});

test("preserves attachment tokens in era-marked messages", () => {
    const parsed = parseWhatsAppLine(
        "\u200e[6/3/1405 AP, 10:08:24\u202fAM] Alex: \u200e<attached: 00000033-AUDIO-2026-08-25-10-08-24.opus>"
    );

    assert.equal(parsed.type, "message");
    assert.equal(parsed.content, "<attached: 00000033-AUDIO-2026-08-25-10-08-24.opus>");
});

test("converts AP date labels for date search and formatted displays", () => {
    const parsed = parseWhatsAppDateLabel("6/11/1405 AP", "MDY");
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth() + 1, 9);
    assert.equal(parsed.getDate(), 2);
});

test("removes directional controls that otherwise break attachment matching", () => {
    assert.equal(
        stripWhatsAppDirectionControls("00000611-\u200e\u2068ارزیابی زوزه\u2069.pdf"),
        "00000611-ارزیابی زوزه.pdf"
    );
});
