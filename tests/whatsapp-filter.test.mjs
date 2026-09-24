import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import { versioned } from "./versioned.mjs";

const { state } = await versioned("../js/whatsapp/state.js");
const {
    filterMessagesBySender,
    applySenderFilter,
    getChatSenders,
    getSenderFilterSummary,
    isMeSender
} = await versioned("../js/whatsapp/filter.js");

describe("whatsapp/filter filterMessagesBySender - multi-participant support", () => {
    const sampleMessages = [
        { type: "date", content: "01/01/2024", rawDate: "01/01/2024", id: "date-0" },
        { type: "system", id: "sys-1", content: "Messages and calls are end-to-end encrypted." },
        { type: "msg", id: "msg-2", sender: "Alice", text: "Hi everyone", mediaItems: [] },
        { type: "msg", id: "msg-3", sender: "Ravi", text: "Hello! Reviewing the document now.", mediaItems: [] },
        { type: "date", content: "02/01/2024", rawDate: "02/01/2024", id: "date-4" },
        { type: "msg", id: "msg-5", sender: "Alice", text: "Did you find the document?", mediaItems: [] },
        { type: "msg", id: "msg-6", sender: "Charlie", text: "I have another document here.", mediaItems: [] },
        { type: "date", content: "03/01/2024", rawDate: "03/01/2024", id: "date-7" },
        { type: "system", id: "sys-8", content: "Ravi changed the subject to 'Docs'" },
        { type: "msg", id: "msg-9", sender: "Ravi", text: "Signed document sent back.", mediaItems: [] },
        { type: "date", content: "04/01/2024", rawDate: "04/01/2024", id: "date-10" },
        { type: "msg", id: "msg-11", sender: "Suresh", text: "Thanks Ravi!", mediaItems: [] }
    ];

    test("zero selected → returns all messages unchanged (array, set, empty string, null, undefined)", () => {
        assert.equal(filterMessagesBySender(sampleMessages, []), sampleMessages);
        assert.equal(filterMessagesBySender(sampleMessages, new Set()), sampleMessages);
        assert.equal(filterMessagesBySender(sampleMessages, ""), sampleMessages);
        assert.equal(filterMessagesBySender(sampleMessages, "   "), sampleMessages);
        assert.equal(filterMessagesBySender(sampleMessages, null), sampleMessages);
        assert.equal(filterMessagesBySender(sampleMessages, undefined), sampleMessages);
        assert.equal(sampleMessages.length, 12);
    });

    test("one selected → only messages from that sender", () => {
        // String format
        const raviOnly = filterMessagesBySender(sampleMessages, "Ravi");
        const msgItems = raviOnly.filter((m) => m.type === "msg");
        assert.equal(msgItems.length, 2);
        assert.deepEqual(msgItems.map((m) => m.id), ["msg-3", "msg-9"]);

        // Array format with 1 item
        const aliceOnly = filterMessagesBySender(sampleMessages, ["Alice"]);
        const aliceMsgs = aliceOnly.filter((m) => m.type === "msg");
        assert.equal(aliceMsgs.length, 2);
        assert.deepEqual(aliceMsgs.map((m) => m.id), ["msg-2", "msg-5"]);

        // Set format with 1 item
        const sureshOnly = filterMessagesBySender(sampleMessages, new Set(["Suresh"]));
        const sureshMsgs = sureshOnly.filter((m) => m.type === "msg");
        assert.equal(sureshMsgs.length, 1);
        assert.equal(sureshMsgs[0].id, "msg-11");
    });

    test("two selected → messages from either sender (OR semantics)", () => {
        // Ravi + Suresh
        const raviAndSuresh = filterMessagesBySender(sampleMessages, ["Ravi", "Suresh"]);
        const msgItems = raviAndSuresh.filter((m) => m.type === "msg");
        assert.equal(msgItems.length, 3);
        assert.deepEqual(msgItems.map((m) => m.id), ["msg-3", "msg-9", "msg-11"]);

        // Alice + Charlie
        const aliceAndCharlie = filterMessagesBySender(sampleMessages, new Set(["Alice", "Charlie"]));
        const acMsgs = aliceAndCharlie.filter((m) => m.type === "msg");
        assert.equal(acMsgs.length, 3);
        assert.deepEqual(acMsgs.map((m) => m.id), ["msg-2", "msg-5", "msg-6"]);
    });

    test("three selected → messages from any of the three senders (OR semantics)", () => {
        const three = filterMessagesBySender(sampleMessages, ["Alice", "Ravi", "Suresh"]);
        const msgItems = three.filter((m) => m.type === "msg");
        assert.equal(msgItems.length, 5);
        assert.deepEqual(msgItems.map((m) => m.id), ["msg-2", "msg-3", "msg-5", "msg-9", "msg-11"]);
        // Charlie's msg-6 is excluded
        assert.equal(three.some((m) => m.sender === "Charlie"), false);
    });

    test("preserves date markers for dates where any selected sender participated", () => {
        // Ravi spoke on Day 1 (01/01) and Day 3 (03/01)
        // Suresh spoke on Day 4 (04/01)
        const raviAndSuresh = filterMessagesBySender(sampleMessages, ["Ravi", "Suresh"]);
        const dateMarkers = raviAndSuresh.filter((m) => m.type === "date");

        assert.equal(dateMarkers.length, 3);
        assert.deepEqual(dateMarkers.map((m) => m.content), [
            "01/01/2024",
            "03/01/2024",
            "04/01/2024"
        ]);

        // Day 2 (where only Alice and Charlie spoke) must be omitted
        assert.equal(raviAndSuresh.some((m) => m.content === "02/01/2024"), false);

        // Verify correct sequence: date marker precedes its corresponding message
        assert.equal(raviAndSuresh[0].id, "date-0");
        assert.equal(raviAndSuresh[1].id, "msg-3");
        assert.equal(raviAndSuresh[2].id, "date-7");
        assert.equal(raviAndSuresh[3].id, "msg-9");
        assert.equal(raviAndSuresh[4].id, "date-10");
        assert.equal(raviAndSuresh[5].id, "msg-11");
    });

    test("does not duplicate date markers when multiple selected senders speak on the same day", () => {
        // Alice and Ravi both spoke on Day 1 (01/01/2024)
        const aliceAndRavi = filterMessagesBySender(sampleMessages, ["Alice", "Ravi"]);
        const date1Markers = aliceAndRavi.filter((m) => m.type === "date" && m.content === "01/01/2024");
        assert.equal(date1Markers.length, 1, "Day 1 marker should appear only once");

        // Order should be date-0, msg-2 (Alice), msg-3 (Ravi)
        assert.equal(aliceAndRavi[0].id, "date-0");
        assert.equal(aliceAndRavi[1].id, "msg-2");
        assert.equal(aliceAndRavi[2].id, "msg-3");
    });

    test("excludes system messages when filtering by one or multiple senders", () => {
        // Single sender
        const raviOnly = filterMessagesBySender(sampleMessages, ["Ravi"]);
        assert.equal(raviOnly.some((m) => m.type === "system"), false);

        // Multiple senders
        const multi = filterMessagesBySender(sampleMessages, ["Alice", "Ravi", "Suresh"]);
        assert.equal(multi.some((m) => m.type === "system"), false);

        // Zero senders retains system messages
        const all = filterMessagesBySender(sampleMessages, []);
        assert.equal(all.filter((m) => m.type === "system").length, 2);
    });

    test("one-to-one chats behavior", () => {
        const oneToOne = [
            { type: "date", content: "01/01/2024", rawDate: "01/01/2024", id: "date-0" },
            { type: "system", id: "sys-1", content: "Messages and calls are end-to-end encrypted." },
            { type: "msg", id: "msg-2", sender: "Alice", text: "Are you free?", isMe: false, mediaItems: [] },
            { type: "msg", id: "msg-3", sender: "Paras", text: "Yes, I am!", isMe: true, mediaItems: [] }
        ];

        // All participants
        const all = filterMessagesBySender(oneToOne, []);
        assert.equal(all.length, 4);

        // Only Alice
        const alice = filterMessagesBySender(oneToOne, ["Alice"]);
        assert.equal(alice.length, 2);
        assert.equal(alice[1].id, "msg-2");

        // Only Paras
        const paras = filterMessagesBySender(oneToOne, ["Paras"]);
        assert.equal(paras.length, 2);
        assert.equal(paras[1].id, "msg-3");

        // Both Alice + Paras (all participants selected explicitly)
        const both = filterMessagesBySender(oneToOne, ["Alice", "Paras"]);
        assert.equal(both.length, 3); // 1 date marker + 2 messages (system message omitted when filtered)
        assert.equal(both[0].id, "date-0");
        assert.equal(both[1].id, "msg-2");
        assert.equal(both[2].id, "msg-3");
    });

    test("clearing selections returns to All participants", () => {
        const selected = ["Ravi", "Charlie"];
        const filtered = filterMessagesBySender(sampleMessages, selected);
        assert.equal(filtered.length < sampleMessages.length, true);

        // Clear selections
        const cleared = filterMessagesBySender(sampleMessages, []);
        assert.equal(cleared.length, sampleMessages.length);
        assert.equal(cleared, sampleMessages);
    });

    test("trims selections but keeps parser sender identities case-sensitive", () => {
        const result = filterMessagesBySender(sampleMessages, [" Ravi ", "Alice"]);
        const msgItems = result.filter((m) => m.type === "msg");
        assert.equal(msgItems.length, 4);
        assert.equal(filterMessagesBySender(sampleMessages, ["ALICE"]).some((entry) => entry.type === "msg"), false);
    });

    test("does not merge participants whose names differ only by case", () => {
        const messages = [
            { type: "date", id: "date-0" },
            { type: "msg", id: "msg-1", sender: "Sam" },
            { type: "msg", id: "msg-2", sender: "sam" }
        ];
        assert.deepEqual(filterMessagesBySender(messages, ["Sam"]).map((entry) => entry.id), ["date-0", "msg-1"]);
        assert.deepEqual(filterMessagesBySender(messages, ["sam"]).map((entry) => entry.id), ["date-0", "msg-2"]);
    });

    test("handles unusual participant names literally", () => {
        const names = ["A&B <Friends>", "__proto__", "constructor", "\"Quoted\"", "👩🏽‍🚀"];
        const messages = [
            ...names.map((sender, index) => ({ type: "msg", id: `msg-${index}`, sender }))
        ];
        for (const sender of names) {
            assert.deepEqual(filterMessagesBySender(messages, [sender]).map((entry) => entry.sender), [sender]);
        }
    });

    test("filters a large export in one pass and keeps only non-orphan day markers", () => {
        const messages = [];
        for (let day = 0; day < 100; day += 1) {
            messages.push({ type: "date", id: `date-${day}`, content: `day ${day}` });
            for (let index = 0; index < 1000; index += 1) {
                const sender = index % 2 ? "Alice" : "Bob";
                messages.push({ type: "msg", id: `msg-${day}-${index}`, sender });
            }
        }

        const result = filterMessagesBySender(messages, ["Bob", "Bob"]);
        assert.equal(result.filter((entry) => entry.type === "msg").length, 50_000);
        assert.equal(result.filter((entry) => entry.type === "date").length, 100);
        assert.equal(result.some((entry) => entry.type === "system"), false);
        for (let index = 0; index < result.length; index += 1) {
            if (result[index].type === "date") assert.equal(result[index + 1]?.type, "msg");
        }
    });

    test("ignores non-existent senders while keeping valid matches", () => {
        const result = filterMessagesBySender(sampleMessages, ["Ravi", "NonExistentUser"]);
        const msgItems = result.filter((m) => m.type === "msg");
        assert.equal(msgItems.length, 2);
        assert.deepEqual(msgItems.map((m) => m.id), ["msg-3", "msg-9"]);
    });

    test("deduplicates selected senders when updating active state", () => {
        const previousDocument = globalThis.document;
        globalThis.document = { getElementById: () => null };
        try {
            state.messages = sampleMessages;
            state.messageOnlyCount = sampleMessages.filter((entry) => entry.type === "msg").length;
            state.senderStats = Object.assign(Object.create(null), { Ravi: 2, Suresh: 1 });
            applySenderFilter(["Ravi", "Ravi", "Suresh"], { silent: true });
            assert.deepEqual(state.selectedSenders, ["Ravi", "Suresh"]);
            assert.deepEqual(state.filteredMessages.filter((entry) => entry.type === "msg").map((entry) => entry.sender), ["Ravi", "Ravi", "Suresh"]);
        } finally {
            globalThis.document = previousDocument;
            state.messages = [];
            state.filteredMessages = [];
            state.selectedSenders = [];
            state.senderStats = Object.create(null);
        }
    });

    test("sender changes refresh even a cleared active search", () => {
        const previousDocument = globalThis.document;
        const liveSearch = { value: "" };
        globalThis.document = {
            getElementById: (id) => id === "live-search" ? liveSearch : null
        };
        try {
            state.messages = sampleMessages;
            state.senderStats = Object.assign(Object.create(null), { Ravi: 2 });
            state.isSearchOpen = true;
            let refreshedQuery = null;
            applySenderFilter(["Ravi"], {
                onSearch: (query) => { refreshedQuery = query; },
                silent: true
            });
            assert.equal(refreshedQuery, "");
        } finally {
            globalThis.document = previousDocument;
            state.messages = [];
            state.filteredMessages = [];
            state.selectedSenders = [];
            state.senderStats = Object.create(null);
            state.isSearchOpen = false;
        }
    });
});

describe("whatsapp/filter combinations with search and date filters", () => {
    const testMessages = [
        { type: "date", content: "01/01/2024", rawDate: "01/01/2024", id: "date-0" },
        { type: "msg", id: "msg-1", sender: "Ravi", text: "Here is the contract document.", mediaItems: [] },
        { type: "msg", id: "msg-2", sender: "Alice", text: "I received the document from Ravi.", mediaItems: [] },
        { type: "msg", id: "msg-3", sender: "Charlie", text: "Meeting document at 3 PM today.", mediaItems: [] },
        { type: "date", content: "02/01/2024", rawDate: "02/01/2024", id: "date-4" },
        { type: "msg", id: "msg-5", sender: "Ravi", text: "Final document approved.", mediaItems: [] },
        { type: "msg", id: "msg-6", sender: "Charlie", text: "See you all tomorrow.", mediaItems: [] },
        { type: "date", content: "03/01/2024", rawDate: "03/01/2024", id: "date-7" },
        { type: "msg", id: "msg-8", sender: "Alice", text: "Invoice document attached.", mediaItems: [] }
    ];

    function searchMessages(messages, query) {
        const q = query.trim().toLowerCase();
        return messages
            .filter((m) => m.type === "msg" && (m.text || "").toLowerCase().includes(q))
            .map((m) => m.id);
    }

    test("multiple selected senders + search", () => {
        // Select Ravi + Charlie: messages msg-1, msg-3, msg-5, msg-6
        const filtered = filterMessagesBySender(testMessages, ["Ravi", "Charlie"]);

        // Search "document": should find Ravi's msg-1, msg-5 and Charlie's msg-3, but NOT Alice's msg-2 or msg-8
        const results = searchMessages(filtered, "document");
        assert.equal(results.length, 3);
        assert.deepEqual(results, ["msg-1", "msg-3", "msg-5"]);
    });

    test("multiple selected senders + date filter", () => {
        // Select Alice + Charlie
        const filtered = filterMessagesBySender(testMessages, ["Alice", "Charlie"]);

        // Alice and Charlie participated on Day 1 (01/01), Day 2 (02/01), and Day 3 (03/01)
        const dateMarkers = filtered.filter((m) => m.type === "date").map((m) => m.content);
        assert.deepEqual(dateMarkers, ["01/01/2024", "02/01/2024", "03/01/2024"]);

        // If we select only Ravi + Charlie:
        // Ravi spoke on Day 1 and Day 2; Charlie on Day 1 and Day 2; neither spoke on Day 3
        const rcFiltered = filterMessagesBySender(testMessages, ["Ravi", "Charlie"]);
        const rcDates = rcFiltered.filter((m) => m.type === "date").map((m) => m.content);
        assert.deepEqual(rcDates, ["01/01/2024", "02/01/2024"]);
        assert.equal(rcDates.includes("03/01/2024"), false);
    });

    test("multiple selected senders + search + date combination", () => {
        // Step 1: Filter to Ravi + Alice
        const raFiltered = filterMessagesBySender(testMessages, ["Ravi", "Alice"]);

        // Step 2: Search "document"
        const docMatches = raFiltered.filter(
            (m) => m.type === "msg" && (m.text || "").toLowerCase().includes("document")
        );
        // docMatches are: msg-1 (Ravi, Day 1), msg-2 (Alice, Day 1), msg-5 (Ravi, Day 2), msg-8 (Alice, Day 3)
        assert.deepEqual(docMatches.map((m) => m.id), ["msg-1", "msg-2", "msg-5", "msg-8"]);

        // Step 3: Date constraint (e.g. Day 1)
        // Find which messages belong under Day 1's section
        let currentDay = "";
        const day1DocMatches = [];
        for (const item of raFiltered) {
            if (item.type === "date") currentDay = item.content;
            if (item.type === "msg" && (item.text || "").toLowerCase().includes("document") && currentDay === "01/01/2024") {
                day1DocMatches.push(item.id);
            }
        }
        assert.deepEqual(day1DocMatches, ["msg-1", "msg-2"]);
    });
});

describe("whatsapp/filter getSenderFilterSummary", () => {
    beforeEach(() => {
        state.myName = "Paras";
    });

    test("0 selected → 'All participants'", () => {
        assert.equal(getSenderFilterSummary([]), "All participants");
        assert.equal(getSenderFilterSummary(new Set()), "All participants");
        assert.equal(getSenderFilterSummary(null), "All participants");
        assert.equal(getSenderFilterSummary(undefined), "All participants");
    });

    test("1 selected → participant name or name with (You)", () => {
        assert.equal(getSenderFilterSummary(["Ravi"]), "Ravi");
        assert.equal(getSenderFilterSummary(["Paras"]), "Paras (You)");
        assert.equal(getSenderFilterSummary(["paras"]), "paras (You)");
        assert.equal(getSenderFilterSummary(["You"]), "You");
        assert.equal(getSenderFilterSummary(new Set(["Alice"])), "Alice");
    });

    test("2 selected → '2 participants'", () => {
        assert.equal(getSenderFilterSummary(["Ravi", "Suresh"]), "2 participants");
        assert.equal(getSenderFilterSummary(new Set(["Ravi", "Paras"])), "2 participants");
    });

    test("3 or more selected → 'N participants'", () => {
        assert.equal(getSenderFilterSummary(["Alice", "Bob", "Charlie"]), "3 participants");
        assert.equal(getSenderFilterSummary(["A", "B", "C", "D"]), "4 participants");
    });
});

describe("whatsapp/filter getChatSenders", () => {
    test("sorts senders by message count descending, then alphabetically", () => {
        const stats = {
            Bob: 10,
            Alice: 50,
            Dave: 5,
            Charlie: 10
        };

        const senders = getChatSenders(stats);
        assert.deepEqual(senders, ["Alice", "Bob", "Charlie", "Dave"]);
    });

    test("handles empty stats safely", () => {
        assert.deepEqual(getChatSenders({}), []);
        assert.deepEqual(getChatSenders(null), []);
    });

    test("includes prototype-shaped names in a null-prototype analytics record", () => {
        const stats = Object.create(null);
        stats.__proto__ = 2;
        stats.constructor = 1;
        assert.deepEqual(getChatSenders(stats), ["__proto__", "constructor"]);
    });
});

describe("whatsapp/filter isMeSender", () => {
    test("recognises 'You' and myName", () => {
        assert.equal(isMeSender("You", "Paras"), true);
        assert.equal(isMeSender("Paras", "Paras"), true);
        assert.equal(isMeSender("paras", "Paras"), true);
        assert.equal(isMeSender("Alice", "Paras"), false);
        assert.equal(isMeSender("", "Paras"), false);
        assert.equal(isMeSender(null, "Paras"), false);
    });
});
