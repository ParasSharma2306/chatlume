import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { versioned } from "./versioned.mjs";

const { filterSidebarChatEntries } = await versioned("../js/whatsapp/sidebar-search.js");

describe("WhatsApp sidebar chat search", () => {
    test("the search input is enabled and wired to input events", () => {
        const html = readFileSync(new URL("../public/viewer.html", import.meta.url), "utf8");
        const script = readFileSync(new URL("../js/script.js", import.meta.url), "utf8");
        const input = html.match(/<input\b[^>]*id="sidebar-chat-search"[^>]*>/)?.[0] || "";

        assert.ok(input, "sidebar search input should exist");
        assert.doesNotMatch(input, /\bdisabled\b|\breadonly\b/i);
        assert.match(script, /\$\("sidebar-chat-search"\)\?\.addEventListener\("input"/);
    });

    test("filters chat titles and saved-chat details without filtering message content", () => {
        const entries = [
            { title: "Family 💛", detail: "Loaded successfully", id: "active" },
            { title: "Weekend plans", detail: "124 messages · 1.2 MB · ZIP", id: "saved-1" },
            { title: "Work", detail: "48 messages · 12 KB · TXT", id: "saved-2" }
        ];

        assert.deepEqual(
            filterSidebarChatEntries(entries, "  WEEKEND ").filter((entry) => entry.visible).map((entry) => entry.id),
            ["saved-1"]
        );
        assert.deepEqual(
            filterSidebarChatEntries(entries, "zip").filter((entry) => entry.visible).map((entry) => entry.id),
            ["saved-1"]
        );
        assert.deepEqual(
            filterSidebarChatEntries(entries, "💛").filter((entry) => entry.visible).map((entry) => entry.id),
            ["active"]
        );
        assert.equal(filterSidebarChatEntries(entries, "   ").every((entry) => entry.visible), true);
    });
});
