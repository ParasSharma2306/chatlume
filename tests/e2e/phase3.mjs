// Phase 3 browser checks: Instagram reactions (and their absence in WhatsApp).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:8765";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`); };

// Every real name a reaction in the fixture carries.
const ACTORS = [/\bBob\b/, /\bJones\b/, /Zo[eë]/, /Ångström/, /\bAnn\b/, /\bRaj\b/, /Patel/, /\bKim\b/, /\bOde\b/, /Lena/, /Omar/, /Haddad/, /\bMei\b/, /Ivan/, /Petrov/, /Sara\b/, /Cohen/, /Tomás/, /Yuki/, /\bNia\b/, /\bOla\b/, /Number Field/, /svg onload/];
const leaks = (text, secrets) => secrets.filter((re) => re.test(text)).map(String);

const { page, close } = await launch({ shots: join(OUT, "shots") });

const visible = (sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.hidden && getComputedStyle(el).display !== "none"; })()`);
const POP = "#ig-reaction-popover";
/** The reaction row of the message whose text contains `text`. */
const rowFor = (text) => `[...document.querySelectorAll("#ig-message-list .msg-row")].find((r) => r.querySelector(".msg-text")?.textContent.includes(${JSON.stringify(text)}))`;
async function bringIntoView(text) {
    for (let i = 0; i < 30; i++) {
        const found = await page.eval(`(() => { const r = ${rowFor(text)}; if (!r) return false; r.scrollIntoView({ block: "center" }); return true; })()`);
        if (found) { await sleep(250); return true; }
        await page.eval(`document.getElementById("ig-viewport").scrollTop = 0`);
        await sleep(150);
    }
    return false;
}
const pillSel = async (text, index = 0) => {
    // Tag the pill so the harness can address it with a plain selector.
    await page.eval(`(() => { document.querySelectorAll("[data-test-pill]").forEach((e) => e.removeAttribute("data-test-pill")); const r = ${rowFor(text)}; r?.querySelectorAll(".ig-reaction")[${index}]?.setAttribute("data-test-pill", ""); })()`);
    return "[data-test-pill]";
};
const popoverNames = () => page.eval(`[...document.querySelectorAll("${POP} .reaction-popover-name")].map((n) => n.textContent)`);
const inViewport = (sel) => page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);

async function captureDownloads() {
    await page.eval(`(() => {
        window.__downloads = [];
        const original = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (this.download && this.href.startsWith("blob:")) { window.__downloads.push({ href: this.href, name: this.download }); return; }
            return original.call(this);
        };
    })()`);
}
async function lastDownload() {
    return page.eval(`(async () => {
        const d = window.__downloads.at(-1); if (!d) return null;
        const bytes = new Uint8Array(await (await fetch(d.href)).arrayBuffer());
        let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { name: d.name, base64: btoa(bin) };
    })()`);
}

async function openDmThread() {
    await page.waitFor(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length > 0`);
    const count = await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length`);
    for (let i = 0; i < count; i++) {
        await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]")[${i}].click()`);
        await sleep(900);
        if (await page.eval(`/media/.test(document.getElementById("ig-header-meta").textContent)`)) return true;
        await page.eval(`document.getElementById("ig-change-thread")?.click()`);
        await sleep(400);
    }
    return false;
}

try {
    // ═══ WhatsApp: nothing fake ═════════════════════════════════════════════
    await page.goto(`${BASE}/public/viewer.html`);
    await page.loadFixture("file-input", "load-chat", "WhatsApp Chat with Weekend Hikers.zip");
    await page.waitFor(`/messages/.test(document.getElementById("header-meta").textContent)`);
    await sleep(400);
    check("WA: no reaction UI anywhere", await page.eval(`!document.querySelector(".ig-reactions, .ig-reaction, .reaction-popover, [data-reactions-for]")`));
    check("WA: help explains reactions aren't in the export", /doesn't include them/.test(await page.eval(`document.getElementById("info-drawer").textContent`)));

    // ═══ Instagram ══════════════════════════════════════════════════════════
    await page.goto(`${BASE}/public/instagram-viewer.html`);
    await captureDownloads();
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-test.zip");
    check("IG: DM thread opened", await openDmThread());

    // Grouping and one-per-person: Bob ❤ + Zoë 😂 then ❤️ → one "❤️ 2" pill.
    await bringIntoView("message 2 with");
    const firstRow = await page.eval(`(() => { const r = ${rowFor("message 2 with")}; return r && [...r.querySelectorAll(".ig-reaction")].map((p) => ({ text: p.innerText.replace(/\\s+/g, " ").trim(), label: p.getAttribute("aria-label") })); })()`);
    check("IG: ❤ and ❤️ collapse into one pill (one per person, latest wins)", firstRow?.length === 1 && firstRow[0].text === "❤️ 2" && firstRow[0].label === "❤️ 2 reactions: Bob Jones and Zoë Ångström", JSON.stringify(firstRow));
    check("IG: no bare ❤ pill anywhere", await page.eval(`![...document.querySelectorAll(".ig-reaction-emoji")].some((e) => e.textContent === "❤")`));
    check("IG: pill row sits under the bubble, not inside it", await page.eval(`(() => { const r = ${rowFor("message 2 with")}; const row = r.querySelector(".ig-reactions"), bubble = r.querySelector(".bubble");
        return !bubble.contains(row) && row.getBoundingClientRect().top >= bubble.getBoundingClientRect().bottom; })()`));
    check("IG: pills never cover the timestamp", await page.eval(`[...document.querySelectorAll("#ig-message-list .msg-row.has-reactions")].every((r) => r.querySelector(".ig-reactions").getBoundingClientRect().top >= r.querySelector(".meta").getBoundingClientRect().bottom)`));
    check("IG: pills are buttons with dialog popups", await page.eval(`[...document.querySelectorAll(".ig-reaction")].every((b) => b.tagName === "BUTTON" && b.getAttribute("aria-haspopup") === "dialog" && b.getAttribute("aria-expanded") === "false")`));
    check("IG: pills are not selectable text", await page.eval(`getComputedStyle(document.querySelector(".ig-reaction")).userSelect === "none"`));

    // Touch: tap opens, tap again closes
    await page.viewport(1280, 860, { touch: true });
    let pill = await pillSel("message 2 with");
    await page.tap(pill);
    check("IG touch: tap opens who-reacted", await visible(POP));
    check("IG touch: lists both people", JSON.stringify(await popoverNames()) === '["Bob Jones","Zoë Ångström"]', JSON.stringify(await popoverNames()));
    check("IG touch: pill reports expanded", await page.eval(`document.querySelector("[data-test-pill]").getAttribute("aria-expanded") === "true"`));
    check("IG touch: popover inside the window", await inViewport(POP));
    check("IG touch: tapping a pill opens nothing else (no media viewer)", await page.eval(`document.getElementById("ig-media-modal").hidden`));
    await page.tap(pill);
    check("IG touch: tapping the pill again closes it", !(await visible(POP)));
    await page.longPress(pill, 700);
    check("IG touch: long-press on a pill just opens the list (no native menu, no gallery menu)", await visible(POP) && !(await page.eval(`!!document.querySelector(".gallery-menu:not([hidden])")`)));
    await page.tap("#ig-header-name");
    check("IG touch: tapping elsewhere closes it", !(await visible(POP)));
    await page.viewport(1280, 860);

    // Keyboard
    pill = await pillSel("message 2 with");
    await page.eval(`document.querySelector("[data-test-pill]").focus()`);
    await page.key("Enter", { code: "Enter", keyCode: 13 });
    await sleep(150);
    check("IG keys: Enter opens, focus moves into the popover", await visible(POP) && await page.eval(`document.getElementById("ig-reaction-popover").contains(document.activeElement)`));
    check("IG keys: popover is a labelled dialog", await page.eval(`(() => { const p = document.getElementById("ig-reaction-popover"); return p.getAttribute("role") === "dialog" && /reactions: Bob Jones and Zoë Ångström/.test(p.getAttribute("aria-label")); })()`));
    await page.key("Escape");
    check("IG keys: Escape closes and returns focus to the pill", !(await visible(POP)) && await page.eval(`document.activeElement?.hasAttribute("data-test-pill")`));
    await page.key(" ", { code: "Space", keyCode: 32 });
    await sleep(150);
    check("IG keys: Space opens it too", await visible(POP));
    await page.key("Tab", { code: "Tab", keyCode: 9 });
    check("IG keys: tabbing away closes it", !(await visible(POP)));
    await page.click(pill);
    await page.eval(`(() => { const v = document.getElementById("ig-viewport"); v.scrollTop += v.scrollTop > 100 ? -100 : 100; v.dispatchEvent(new Event("scroll")); })()`);
    await sleep(250);
    check("IG: scrolling the chat closes it", !(await visible(POP)));

    // Many different reactions → 5 pills + "+N", which lists everyone
    await bringIntoView("many reactions here");
    const many = await page.eval(`(() => { const r = ${rowFor("many reactions here")}; return [...r.querySelectorAll(".ig-reaction")].map((p) => p.innerText.trim()); })()`);
    check("IG: many reactions fold into 5 pills + “+7”", many.length === 6 && many[5] === "+7", JSON.stringify(many));
    await page.click(await pillSel("many reactions here", 5));
    const everyone = await popoverNames();
    check("IG: “+N” lists all 12 people", everyone.length === 12, JSON.stringify(everyone));
    check("IG: right-aligned (sent) message keeps its popover on screen", await inViewport(POP));
    await page.screenshot("ig-reactions-many");
    await page.key("Escape");

    // Edge cases + injection
    await bringIntoView("reaction edge cases");
    const edge = await page.eval(`(() => { const r = ${rowFor("reaction edge cases")}; return [...r.querySelectorAll(".ig-reaction")].map((p) => ({ text: p.innerText.replace(/\\s+/g, " ").trim(), label: p.getAttribute("aria-label") })); })()`);
    check("IG: edge cases → 😂 2, <img… 1, 👍 1 (Bob once); number field dropped", JSON.stringify(edge.map((e) => e.text)) === JSON.stringify(["😂 2", "<img…", "👍"]) && /👍 1 reaction: Bob Jones$/.test(edge[2].label), JSON.stringify(edge));
    await page.click(await pillSel("reaction edge cases", 0));
    const laughs = await popoverNames();
    check("IG: injected actor name shown as text; missing actor is “Someone”", JSON.stringify(laughs) === JSON.stringify(['"><svg onload=alert(8)>', "Someone"]), JSON.stringify(laughs));
    check("IG: nothing injected became markup", await page.eval(`!document.querySelector("svg[onload], img[onerror], #ig-message-list script, .reaction-popover script")`));
    await page.key("Escape");

    // Gallery still works next to reactions (its long-press is its own)
    await page.click("#ig-menu-toggle");
    await page.click("#ig-gallery-action");
    await page.waitFor(`!document.getElementById("ig-gallery-panel").hidden`);
    await page.waitFor(`document.querySelectorAll("#ig-gallery-tabpanel-media .gallery-photo").length > 2`);
    await page.viewport(1280, 860, { touch: true });
    await page.longPress("#ig-gallery-tabpanel-media .gallery-photo", 650);
    check("IG: gallery long-press menu unaffected", await visible("#ig-gallery-menu") && !(await visible(POP)));
    await page.key("Escape");
    await page.key("Escape");
    await page.viewport(1280, 860);

    // Anonymize: pills, labels, popover, exports
    await page.click("#ig-menu-toggle");
    await page.click("#ig-anonymize-toggle");
    await sleep(400);
    let dump = "";
    for (const text of ["message 2 with", "many reactions here", "reaction edge cases", "my own message"]) {
        await bringIntoView(text);
        const idx = await page.eval(`${rowFor(text)}.querySelectorAll(".ig-reaction").length`);
        for (let i = 0; i < idx; i++) {
            await page.click(await pillSel(text, i));
            dump += await page.eval(`document.getElementById("ig-reaction-popover").outerHTML`);
            await page.key("Escape");
        }
        dump += await page.eval(`${rowFor(text)}.outerHTML`);
    }
    check("IG anon: pills, aria-labels and popovers name no one", leaks(dump, ACTORS).length === 0, leaks(dump, ACTORS).join(", "));
    check("IG anon: aliases shown instead", /Person [A-Z]/.test(dump));
    pill = await pillSel("my own message");
    await page.click(pill);
    await page.click("#ig-menu-toggle");
    await page.click("#ig-anonymize-toggle");
    await sleep(300);
    check("IG: switching Anonymize closes an open popover", !(await visible(POP)));
    await page.click("#ig-menu-toggle");
    await page.click("#ig-anonymize-toggle");
    await sleep(300);

    await page.click("#ig-menu-toggle");
    await page.click("#ig-export-chat-btn");
    await sleep(800);
    const html = Buffer.from((await lastDownload()).base64, "base64").toString("utf8");
    writeFileSync(join(OUT, "ig-reactions-export.html"), html);
    check("IG export (.html): reactions grouped, with who reacted", /<details class="ce-reactions">/.test(html) && /❤️ <small>2<\/small>/.test(html) && /<ul class="ce-reactors">/.test(html));
    check("IG export (.html): anonymized actors only", leaks(html.replace(/<title>[^<]*<\/title>/, ""), ACTORS).length === 0, leaks(html, ACTORS).join(", "));
    check("IG export (.html): injection inert", !/<svg onload|<img src=x/.test(html));
    await page.click("#ig-menu-toggle");
    await page.click("#ig-export-chat-media-btn");
    await page.waitFor(`window.__downloads.length >= 2`, { timeout: 30000 });
    const zipPath = join(OUT, "ig-reactions-export.zip");
    writeFileSync(zipPath, Buffer.from((await lastDownload()).base64, "base64"));
    const unpacked = join(OUT, "ig-reactions-zip");
    rmSync(unpacked, { recursive: true, force: true });
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", unpacked]);
    const zipHtml = readFileSync(join(unpacked, "index.html"), "utf8");
    check("IG export (.zip): reactions with who reacted, anonymized", /<details class="ce-reactions">/.test(zipHtml) && leaks(zipHtml, ACTORS).length === 0, leaks(zipHtml, ACTORS).join(", "));
    await page.click("#ig-anonymize-banner-off");
    await sleep(300);

    // Exported file in a browser: the list opens by tap/Enter without script
    await page.goto(`file://${join(OUT, "ig-reactions-export.html")}`);
    await page.eval(`document.querySelector(".ce-reactions summary").focus()`);
    await page.key("Enter", { code: "Enter", keyCode: 13 });
    check("export file: Enter on the pills reveals who reacted", await page.eval(`document.querySelector(".ce-reactions").open === true`));

    // Mobile + dark/light
    // Size first: the viewer decides its phone layout when it boots.
    await page.viewport(390, 844, { mobile: true, touch: true });
    await page.goto(`${BASE}/public/instagram-viewer.html`);
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-test.zip");
    check("IG mobile: DM thread opened", await openDmThread());
    await page.eval(`document.getElementById("ig-sidebar")?.classList.remove("active")`);
    await bringIntoView("many reactions here");
    check("IG mobile: pill row fits the screen", await page.eval(`(() => { const r = ${rowFor("many reactions here")}.querySelector(".ig-reactions").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`));
    check("IG mobile: pills are at least 28px tall (tap target)", await page.eval(`[...document.querySelectorAll(".ig-reaction")].every((p) => p.getBoundingClientRect().height >= 28)`));
    await page.tap(await pillSel("many reactions here", 5));
    check("IG mobile: popover fits the screen", await visible(POP) && await inViewport(POP));
    await page.screenshot("ig-reactions-mobile-dark");
    await page.tap("#ig-header-name");
    await page.eval(`document.body.classList.add("light-theme")`);
    await bringIntoView("message 2 with");
    await page.tap(await pillSel("message 2 with"));
    check("IG mobile light: popover readable (text darker than its background)", await page.eval(`(() => { const p = document.getElementById("ig-reaction-popover"); const c = getComputedStyle(p.querySelector(".reaction-popover-name")).color; return getComputedStyle(p).backgroundColor !== c; })()`));
    await page.screenshot("ig-reactions-mobile-light");
    await page.tap("#ig-header-name");
    await page.eval(`document.body.classList.remove("light-theme")`);
    await page.viewport(1280, 860);

    // Long chat: 50k messages, reactions on every 7th
    await page.goto(`${BASE}/public/instagram-viewer.html`);
    const t0 = Date.now();
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-big.zip");
    await page.waitFor(`document.getElementById("ig-header-name").textContent === "Big Thread"`, { timeout: 90000 });
    const loadMs = Date.now() - t0;
    check(`IG big: 50k-message thread with reactions opens (${loadMs}ms)`, loadMs < 30000);
    const bigPills = await page.eval(`[...document.querySelectorAll("#ig-message-list .ig-reactions")].map((r) => [...r.querySelectorAll(".ig-reaction")].map((p) => p.innerText.replace(/\\s+/g, " ").trim()).join("|"))`);
    check("IG big: pills render in the window and ❤/❤️ merge", bigPills.length > 10 && bigPills.every((p) => p === "❤️ 2" || p === "❤️|😂"), JSON.stringify(bigPills.slice(0, 6)));
    for (let i = 0; i < 15; i++) { await page.eval(`document.getElementById("ig-viewport").scrollTop = 0`); await sleep(120); }
    check("IG big: DOM stays bounded while scrolling", (await page.eval(`document.querySelectorAll("#ig-message-list .msg-row").length`)) <= 200);

    const errors = page.logs.filter((l) => /exception|error/.test(l.type) && !/umami|favicon|net::ERR|Failed to load resource/.test(l.text));
    check("no page exceptions / console errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
    check("no JS dialogs (XSS) fired", page.dialogs.length === 0, JSON.stringify(page.dialogs));
} catch (error) {
    check("harness", false, error.stack);
} finally {
    await close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
}
