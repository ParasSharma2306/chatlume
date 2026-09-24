import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const { exportChatAsHTML } = await versioned("../js/export.js");

async function captureExport(options) {
    const previousDocument = globalThis.document;
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    const originalSetTimeout = globalThis.setTimeout;
    let capturedBlob;
    globalThis.document = {
        createElement: () => ({ style: {}, click() {} }),
        body: { appendChild() {}, removeChild() {} }
    };
    URL.createObjectURL = (blob) => {
        capturedBlob = blob;
        return "blob:chatlume-test";
    };
    URL.revokeObjectURL = () => {};
    globalThis.setTimeout = (callback) => {
        callback();
        return 0;
    };

    try {
        exportChatAsHTML(options);
        return await capturedBlob.text();
    } finally {
        globalThis.document = previousDocument;
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        globalThis.setTimeout = originalSetTimeout;
    }
}

describe("HTML export", () => {
    test("preserves all messages and metadata when no sender filter is active", async () => {
        const html = await captureExport({
            title: "Family Chat",
            messageCount: 2,
            messages: [
                { type: "date", label: "Jan 1, 2024" },
                { type: "system", text: "Alice added Bob" },
                { type: "msg", sender: "Alice", text: "Hello" },
                { type: "msg", sender: "Bob", text: "Hi" }
            ]
        });

        assert.match(html, /ChatLume Export — Family Chat/);
        assert.match(html, /2 messages/);
        assert.match(html, /Alice added Bob/);
        assert.match(html, /Hello/);
        assert.match(html, /Hi/);
    });

    test("exports only the selected participants with accurate title and count", async () => {
        const html = await captureExport({
            title: "Project (2 participants)",
            messageCount: 2,
            messages: [
                { type: "date", label: "Jan 1, 2024" },
                { type: "msg", sender: "Alice", text: "Ready" },
                { type: "msg", sender: "Ravi", text: "Go" }
            ]
        });

        assert.match(html, /ChatLume Export — Project \(2 participants\)/);
        assert.match(html, /2 messages/);
        assert.match(html, /Ready/);
        assert.match(html, /Go/);
        assert.doesNotMatch(html, /Bob|excluded message/);
    });
});
