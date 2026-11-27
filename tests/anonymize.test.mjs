import assert from "node:assert/strict";
import { describe, test, before } from "node:test";
import { versioned } from "./versioned.mjs";

// The viewer modules look elements up by id; in Node there are none.
globalThis.document ??= {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, click() {} }),
    body: { classList: { toggle() {}, contains: () => false }, appendChild() {}, removeChild() {} }
};
globalThis.window ??= globalThis;

const {
    aliasForIndex,
    collectChatNames,
    createAnonymizeView,
    createAnonymizer,
    extractSystemNames,
    looksLikePhone
} = await versioned("../js/shared/anonymize.js");

const anonymizerFor = (names, subjects = []) => createAnonymizer({ names, subjects });

describe("anonymize: aliases", () => {
    test("letters run A–Z, then AA, AB, …", () => {
        assert.equal(aliasForIndex(0), "Person A");
        assert.equal(aliasForIndex(25), "Person Z");
        assert.equal(aliasForIndex(26), "Person AA");
        assert.equal(aliasForIndex(27), "Person AB");
        assert.equal(aliasForIndex(701), "Person ZZ");
        assert.equal(aliasForIndex(702), "Person AAA");
    });

    test("each participant keeps one alias, in first-seen order", () => {
        const anon = anonymizerFor(["Alice Smith", "Bob", "Carol"]);
        assert.equal(anon.name("Alice Smith"), "Person A");
        assert.equal(anon.name("Bob"), "Person B");
        assert.equal(anon.name("Carol"), "Person C");
        assert.equal(anon.name("Bob"), "Person B");
        assert.equal(anon.realName("Person B"), "Bob");
    });

    test("names that differ only in case stay distinct people", () => {
        const anon = anonymizerFor(["Sam", "sam"]);
        assert.notEqual(anon.name("Sam"), anon.name("sam"));
    });

    test("an alias never collides with a real participant called 'Person B'", () => {
        const anon = anonymizerFor(["Alice", "Person B", "Carol"]);
        const aliases = ["Alice", "Person B", "Carol"].map((name) => anon.name(name));
        assert.equal(new Set(aliases).size, 3);
        assert.ok(!aliases.includes("Person B"), aliases.join());
        // and the real "Person B" in text becomes their alias, not left as-is
        assert.equal(anon.text("Person B said hi"), `${anon.name("Person B")} said hi`);
    });

    test("'You' is not a name and stays; unknown names get the next free alias", () => {
        const anon = anonymizerFor(["Alice"]);
        assert.equal(anon.name("You"), "You");
        assert.equal(anon.name("Mallory"), "Person B");
        assert.equal(anon.name("Mallory"), "Person B");
        assert.equal(anon.text("ask Mallory"), "ask Person B");
        assert.equal(anon.name(""), "");
    });
});

describe("anonymize: text masking", () => {
    const anon = anonymizerFor(["Alice Smith", "Bob Jones", "Bob Smith", "+91 98765 43210", "Al", "Will Turner"]);

    test("full names match in any case; parts match as written", () => {
        assert.equal(anon.text("alice smith and ALICE SMITH"), "Person A and Person A");
        assert.equal(anon.text("Hey Alice!"), "Hey Person A!");
        // lowercase parts are ordinary words, not names
        assert.equal(anon.text("I will go, alice"), "I will go, alice");
        assert.equal(anon.text("Will said so"), "Person F said so");
    });

    test("a part two people share becomes [name]", () => {
        assert.equal(anon.text("Smith called"), "[name] called");
        assert.equal(anon.text("Bob called"), "[name] called");
        assert.equal(anon.text("Bob Jones called"), "Person B called");
    });

    test("short names only match exactly, never inside words", () => {
        assert.equal(anon.text("Al is here, al is not, also Alan"), "Person E is here, al is not, also Alan");
    });

    test("possessives and punctuation around names", () => {
        assert.equal(anon.text("Alice's cat (Bob Jones), [Alice Smith]."), "Person A's cat (Person B), [Person A].");
    });

    test("emails, phones and handles", () => {
        assert.equal(anon.text("mail alice.smith@example.co.uk now"), "mail [email] now");
        assert.equal(anon.text("call +1 (555) 123-4567"), "call [phone]");
        assert.equal(anon.text("or 555.123.4567 or 5551234567"), "or [phone] or [phone]");
        assert.equal(anon.text("hi @someone and @alice_smith"), "hi @[user] and @Person A");
        assert.equal(anon.text("@Alice Smith look"), "@Person A look");
    });

    test("a phone-number participant is their alias wherever the number appears", () => {
        const alias = anon.name("+91 98765 43210");
        assert.equal(anon.text("+91 98765 43210 joined"), `${alias} joined`);
        assert.equal(anon.text("ping @919876543210"), `ping @${alias}`);
        assert.equal(anon.text("local 98765 43210"), `local ${alias}`);
    });

    test("dates, times, counters and WhatsApp file names are not phone numbers", () => {
        for (const text of [
            "2020-01-01 10:30", "12.05.2020", "10.30-11.45", "IMG-20200101-WA0001.jpg",
            "00000012-PHOTO-2020-01-01-10-30-00.jpg", "1,000,000", "id 12345678901234567890", "v1.2.3"
        ]) {
            assert.equal(anon.text(text), text, text);
        }
        assert.equal(looksLikePhone("20200101"), false);
        assert.equal(looksLikePhone("+44 20 7946 0958"), true);
    });

    test("HTML in names and text passes through as text (callers escape)", () => {
        const evil = anonymizerFor(["<img src=x onerror=alert(1)>", "Eve\"><script>"]);
        assert.equal(evil.name("<img src=x onerror=alert(1)>"), "Person A");
        assert.equal(evil.text("<b>hi</b> <img src=x onerror=alert(1)>"), "<b>hi</b> Person A");
        assert.ok(!evil.text("Eve\"><script> says hi").includes("<script>"));
    });

    test("regex metacharacters in names are literal", () => {
        const odd = anonymizerFor(["J.R. (Bob) [x]*", "a+b?"]);
        assert.equal(odd.text("met J.R. (Bob) [x]* today"), "met Person A today");
        // "." is literal, so only the "Bob" part matches here
        assert.equal(odd.text("JxR. (Bob) [x]* today"), "JxR. (Person A) [x]* today");
    });

    test("emoji and RTL names", () => {
        const intl = anonymizerFor(["Mom ❤️", "محمد علي", "José Núñez"]);
        assert.equal(intl.text("love you Mom ❤️!"), "love you Person A!");
        assert.equal(intl.text("قال محمد علي مرحبا"), "قال Person B مرحبا");
        assert.equal(intl.text("josé núñez y José"), "Person C y Person C");
    });

    test("file names treat '_' as a separator", () => {
        // "Smith" is shared by Alice Smith and Bob Smith
        assert.equal(anon.fileName("Alice_Smith_CV.pdf"), "Person A_[name]_CV.pdf");
        assert.equal(anon.fileName("Bob Jones.vcf"), "Person B.vcf");
        assert.equal(anon.fileName("PTT-20200101-WA0001.opus"), "PTT-20200101-WA0001.opus");
        // WhatsApp's generated names are left alone even when the date isn't a real one
        assert.equal(anon.fileName("IMG-20240199-WA9999.jpg"), "IMG-20240199-WA9999.jpg");
        assert.equal(anon.fileName("Call 5551234567.jpg"), "Call [phone].jpg");
    });

    test("group subjects become [group name]", () => {
        const group = anonymizerFor(["Alice", "Bob", "Carol"], ["Weekend Hikers"]);
        assert.equal(group.text("Welcome to Weekend Hikers!"), "Welcome to [group name]!");
    });

    test("pathological input stays linear", () => {
        for (const input of ["a+".repeat(50000), "1 ".repeat(50000) + "x", "@".repeat(50000), `${"a.".repeat(50000)}@`, "9".repeat(100000)]) {
            const started = performance.now();
            anon.text(input);
            assert.ok(performance.now() - started < 1500, `slow on ${input.slice(0, 8)}…`);
        }
    });
});

describe("anonymize: titles", () => {
    test("a one-to-one chat named after the other person shows their alias", () => {
        const anon = anonymizerFor(["Jane Doe", "Me"]);
        assert.equal(anon.title("Jane Doe"), "Person A");
        assert.equal(anon.title("jane doe"), "Person A");
        assert.equal(anon.title("Jane"), "Person A");
        assert.equal(anon.title("Something else"), "Chat");
        assert.equal(anon.title(""), "Chat");
    });

    test("a group's title never survives", () => {
        const anon = anonymizerFor(["A1", "B2", "C3"]);
        assert.equal(anon.title("Smith Family"), "Group chat");
    });
});

describe("anonymize: names in group events", () => {
    test("actors and objects", () => {
        assert.deepEqual(extractSystemNames("Alice added Bob, Carol and Dave").names, ["Alice", "Bob", "Carol", "Dave"]);
        assert.deepEqual(extractSystemNames("Alice removed Bob").names, ["Alice", "Bob"]);
        assert.deepEqual(extractSystemNames("Bob left").names, ["Bob"]);
        assert.deepEqual(extractSystemNames("+1 555 123 4567 joined using this group's invite link").names, ["+1 555 123 4567"]);
        assert.deepEqual(extractSystemNames("You added Zed and Yara").names, ["Zed", "Yara"]);
        assert.deepEqual(extractSystemNames("Alice made Bob an admin").names, ["Alice", "Bob"]);
    });

    test("security-code notices and subjects", () => {
        assert.deepEqual(extractSystemNames("Your security code with Eve Adams changed. Tap to learn more.").names, ["Eve Adams"]);
        assert.deepEqual(extractSystemNames("Eve's security code changed. Tap to learn more.").names, ["Eve"]);
        assert.deepEqual(extractSystemNames('Alice created group "Weekend Hikers"'), { names: ["Alice"], subjects: ["Weekend Hikers"] });
        assert.deepEqual(extractSystemNames('Bob changed the subject from "Old" to "New Name"').subjects, ["Old", "New Name"]);
    });

    test("notices without people yield nothing", () => {
        assert.deepEqual(extractSystemNames("Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.").names, []);
        assert.deepEqual(extractSystemNames("You deleted this message").names, []);
        assert.deepEqual(extractSystemNames("").names, []);
    });

    test("collectChatNames orders by first appearance and includes reactions and participants", () => {
        const { names, subjects } = collectChatNames([
            { type: "system", content: "Ann created group \"Book Club\"" },
            { type: "system", content: "Ann added Ben" },
            { type: "msg", sender: "Cy", reactions: [{ actor: "Dee", reaction: "👍" }] },
            { type: "msg", sender: "You" },
            { type: "msg", sender: "Ben" }
        ], { participants: ["Ann", "Eli"] });
        assert.deepEqual(names, ["Ann", "Ben", "Cy", "Dee", "Eli"]);
        assert.deepEqual(subjects, ["Book Club"]);
    });
});

describe("anonymize: view", () => {
    test("identity while off, aliases while on, rebuilt when the chat changes", () => {
        let messages = [{ type: "msg", sender: "Alice" }];
        const view = createAnonymizeView(() => ({ messages }));
        view.setOn(false);
        assert.equal(view.name("Alice"), "Alice");
        assert.equal(view.text("hi Alice"), "hi Alice");
        view.setOn(true);
        assert.equal(view.name("Alice"), "Person A");
        assert.equal(view.realName("Person A"), "Alice");
        messages = [{ type: "msg", sender: "Zed" }, { type: "msg", sender: "Alice" }];
        assert.equal(view.name("Zed"), "Person A");
        assert.equal(view.name("Alice"), "Person B");
        view.setOn(false);
        assert.equal(view.realName("Person A"), "Person A");
    });
});

// ── End to end: real parsers → Anonymize → real HTML export ─────────────────

async function captureExport(exportChatAsHTML, options) {
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

const SECRETS = ["Alice", "Smith", "Bob", "Jones", "Carol", "Dave", "Weekend Hikers", "98765", "43210", "alice@example.com", "555-0199", "0199"];

describe("anonymize: WhatsApp export leaks nothing", () => {
    let html = "";
    before(async () => {
        const { state } = await versioned("../js/whatsapp/state.js");
        const { parseChatData } = await versioned("../js/whatsapp/parser.js");
        const { collectExportMessages } = await versioned("../js/whatsapp/render.js");
        const { display, shownTitle } = await versioned("../js/whatsapp/anonymize.js");
        const { exportChatAsHTML } = await versioned("../js/export.js");
        const { resetChatState } = await versioned("../js/whatsapp/session.js");

        resetChatState();
        state.myName = "Alice Smith";
        await parseChatData([
            "01/02/2024, 10:00 - Alice Smith created group \"Weekend Hikers\"",
            "01/02/2024, 10:01 - Alice Smith added Bob Jones and +91 98765 43210",
            "01/02/2024, 10:02 - Alice Smith: Hi Bob! Mail me at alice@example.com or call 555-0199 ext, or +1 202 555 0199",
            "01/02/2024, 10:03 - Bob Jones: Thanks Alice, tell Carol and @Dave",
            "01/02/2024, 10:03 - Carol: on it",
            "01/02/2024, 10:04 - +91 98765 43210: hello from 98765 43210 <script>alert('Alice')</script>",
            "01/02/2024, 10:05 - Bob Jones: Bob Jones.vcf (file attached)",
            "01/02/2024, 10:06 - Dave left",
            "01/02/2024, 10:07 - Bob Jones: profile https://example.com/u/Alice%20Smith/919876543210 and https://example.com/people/Bob_Jones plus https://example.com/ok"
        ].join("\n"));
        state.chatTitle = "Weekend Hikers";
        display.setOn(true);
        html = await captureExport(exportChatAsHTML, {
            title: shownTitle(),
            messageCount: state.messageOnlyCount,
            messages: collectExportMessages()
        });
        display.setOn(false);
    });

    test("no original names, numbers or emails anywhere in the file", () => {
        for (const secret of SECRETS) {
            assert.ok(!html.includes(secret), `export leaks "${secret}"`);
        }
    });

    test("placeholders, structure and escaping survive", () => {
        assert.match(html, /<title>ChatLume Export — Group chat<\/title>/);
        assert.match(html, /Person A created group &quot;\[group name\]&quot;/);
        assert.match(html, /\[email\]/);
        assert.match(html, /\[phone\]/);
        assert.match(html, /&lt;script&gt;/);
        assert.doesNotMatch(html, /<script>alert/);
    });

    test("a link with a hidden name becomes masked text, never a half-masked link", () => {
        assert.match(html, /<a href="https:\/\/example\.com\/ok"/, "a link with nothing to hide still links");
        assert.doesNotMatch(html, /href="https:\/\/example\.com\/(u|people)\//, "no link to a masked address");
        // The number is a participant's, so it becomes their alias, as everywhere else.
        assert.match(html, /example\.com\/u\/Person A\/Person [A-Z]\b/);
        assert.doesNotMatch(html, /Bob_Jones|919876543210/);
    });
});

describe("anonymize: Instagram export leaks nothing, reactions included", () => {
    let html = "";
    let messages = [];
    before(async () => {
        const mangle = (text) => Buffer.from(text, "utf8").toString("latin1");
        const { igState } = await versioned("../js/instagram/state.js");
        const { parseMessages } = await versioned("../js/instagram/parser.js");
        const { collectExportMessages } = await versioned("../js/instagram/render.js");
        const { display, shownTitle } = await versioned("../js/instagram/anonymize.js");
        const { exportChatAsHTML } = await versioned("../js/export.js");

        igState.messages = [];
        igState.myName = "Alice Smith";
        igState.chatTitle = "Bob Jones";
        igState.participants = ["Bob Jones", "Alice Smith", "Carol Dave"];
        parseMessages([
            { sender_name: mangle("Alice Smith"), timestamp_ms: 1700000000000, content: mangle("Hi Bob ❤️ alice@example.com"), reactions: [{ reaction: mangle("❤"), actor: mangle("Bob Jones") }, { reaction: mangle("😂"), actor: mangle("Carol Dave") }] },
            { sender_name: "Bob Jones", timestamp_ms: 1700000001000, content: "call 555-0199 or +91 98765 43210", share: { link: "https://example.com/Jones", share_text: "Alice's post" } },
            { sender_name: "Bob Jones", timestamp_ms: 1700000002000, reactions: [{ reaction: "👍", actor: "Alice Smith" }] }
        ]);
        messages = igState.messages;
        display.setOn(true);
        html = await captureExport(exportChatAsHTML, {
            theme: "instagram",
            title: shownTitle(),
            messageCount: igState.messageOnlyCount,
            messages: collectExportMessages()
        });
        display.setOn(false);
    });

    test("reaction emojis and actors are mojibake-repaired by the parser", () => {
        const first = messages.find((item) => item.type === "msg");
        assert.deepEqual(first.reactions, [{ reaction: "❤", actor: "Bob Jones" }, { reaction: "😂", actor: "Carol Dave" }]);
        assert.equal(first.sender, "Alice Smith");
        assert.equal(first.text, "Hi Bob ❤️ alice@example.com");
    });

    test("no original names, numbers or emails anywhere in the file", () => {
        for (const secret of SECRETS) {
            assert.ok(!html.includes(secret), `export leaks "${secret}"`);
        }
    });

    test("reaction emojis are exported", () => {
        assert.match(html, /😂/);
        assert.match(html, /👍/);
    });

    test("a share link that had to be masked is text, not a link", () => {
        assert.doesNotMatch(html, /href="https:\/\/example\.com/);
        assert.match(html, /Person A&#39;s post/);
    });
});
