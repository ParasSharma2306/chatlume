// Phase 2 browser checks: media/links/docs gallery in both viewers.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:8765";
const PORT = 9333;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`); };

const WA_SECRETS = [/\bAlice\b/, /\bSmith\b/, /\bBob\b/, /\bJones\b/, /\bCarol\b/, /\bDiaz\b/, /\bDave\b/, /Weekend Hikers/, /98765/, /43210/, /bob\.jones@example\.com/, /محمد/, /שרה/, /onerror=alert/];
const IG_SECRETS = [/\bBob\b/, /\bJones\b/, /Zo[eë]/i, /Ångström|Angstrom/i, /Mallory/, /bobjones/i];
const leaks = (text, secrets) => secrets.filter((re) => re.test(text)).map(String);

// Tracks every blob URL so orphans (created, never revoked, not shown) are visible.
const TRACK = `(() => {
    window.__liveUrls = new Set();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); window.__liveUrls.add(url); return url; };
    URL.revokeObjectURL = (url) => { window.__liveUrls.delete(url); return revoke(url); };
})();`;
// Blob URLs still alive beyond what the chat's render window may hold (the
// chat keeps URLs for media in its window even before they scroll into view).
const ORPHANS = (list) => `(() => { const held = new Set([...document.querySelectorAll("${list} [data-media-id], ${list} [data-open-media], ${list} [data-download-media]")].map((e) => e.dataset.mediaId || e.dataset.openMedia || e.dataset.downloadMedia)).size;
    return Math.max(0, window.__liveUrls.size - held); })()`;

const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
async function closeExtraTargets(keepId) {
    for (const t of await pageTargets()) if (t.id !== keepId) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
}

const { page, close } = await launch({ port: PORT, shots: join(OUT, "shots") });
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TRACK });
const mainTarget = (await pageTargets())[0].id;

const G = (p) => ({
    panel: `#${p}-panel`, scroll: `#${p}-scroll`, menu: `#${p}-menu`,
    tab: (k) => `#${p}-tab-${k}`, tabpanel: (k) => `#${p}-tabpanel-${k}`
});
const visible = (sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.hidden && getComputedStyle(el).display !== "none"; })()`);
const count = (sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const text = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent || ""`);
const active = () => page.eval(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : ""; })()`);

async function loadAnother(name) {
    await page.eval(`document.getElementById("import-another")?.click()`);
    await sleep(250);
    await page.loadFixture("file-input", "load-chat", name);
}

async function openGallery(menuToggle, action, panelSel) {
    await page.click(menuToggle);
    await page.click(action);
    await page.waitFor(`!document.querySelector(${JSON.stringify(panelSel)})?.hidden`);
    await sleep(200);
}

try {
    // ═══ WhatsApp: ZIP with media ═══════════════════════════════════════════
    const g = G("gallery");
    await page.goto(`${BASE}/public/viewer.html`);
    await page.loadFixture("file-input", "load-chat", "WhatsApp Chat with Weekend Hikers.zip");
    await page.waitFor(`/messages/.test(document.getElementById("header-meta").textContent)`);
    await sleep(600);

    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    check("WA: gallery opens from the chat menu", await visible(g.panel));
    check("WA: tabs are Media, Links, Docs", JSON.stringify(await page.eval(`[...document.querySelectorAll("#gallery-panel [role=tab]")].map((t) => t.querySelector("span").textContent)`)) === '["Media","Links","Docs"]');
    check("WA: tablist/tab/tabpanel roles wired", await page.eval(`(() => {
        const tabs = [...document.querySelectorAll("#gallery-panel [role=tablist] [role=tab]")];
        return tabs.length === 3 && tabs.every((t) => { const p = document.getElementById(t.getAttribute("aria-controls")); return p && p.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby") === t.id; })
            && tabs[0].getAttribute("aria-selected") === "true" && tabs[0].tabIndex === 0 && tabs[1].tabIndex === -1;
    })()`));
    check("WA: focus moves to the selected tab", (await active()) === "gallery-tab-media");
    const counts = await page.eval(`[...document.querySelectorAll("#gallery-panel [data-gallery-count]")].map((c) => c.textContent)`);
    check("WA: counts media 16 / links 6 / docs 10", JSON.stringify(counts) === '["16","6","10"]', JSON.stringify(counts));
    check("WA: missing-photo notice shown", /1 photo or video mentioned in the chat isn't in this export/.test(await text(`${g.tabpanel("media")} .gallery-notice`)));
    check("WA: chat hidden from AT while gallery open", await page.eval(`document.getElementById("viewport").inert === true && document.getElementById("viewport").getAttribute("aria-hidden") === "true"`));
    check("WA: jump-to-latest hidden while gallery open", !(await visible("#scroll-latest")));
    await page.waitFor(`document.querySelectorAll("#gallery-tabpanel-media .gallery-photo.loaded").length >= 8`, { timeout: 15000 });
    check("WA: thumbnails lazy-load", true);
    await page.waitFor(`!!document.querySelector("#gallery-tabpanel-media .gallery-video.loaded")`, { timeout: 15000 }).catch(() => {});
    check("WA: video tile shows a frame", await page.eval(`!!document.querySelector("#gallery-tabpanel-media .gallery-video.loaded")`));
    check("WA: items are unselectable", await page.eval(`getComputedStyle(document.querySelector(".gallery-item")).userSelect === "none"`));
    await page.screenshot("wa-gallery-media");

    // Native context menu suppressed + ours opens (right-click)
    const prevented = await page.eval(`(() => { const t = document.querySelectorAll("#gallery-tabpanel-media .gallery-photo")[2]; const r = t.getBoundingClientRect();
        return !t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 10, clientY: r.top + 10 })); })()`);
    check("WA: native context menu suppressed on items", prevented);
    check("WA: right-click opens Jump menu", await visible(g.menu));
    check("WA: menu item focused (role=menuitem)", await page.eval(`document.activeElement?.getAttribute("role") === "menuitem"`));
    await page.key("Escape");
    check("WA: Escape closes menu, focus back on item", !(await visible(g.menu)) && await page.eval(`document.activeElement?.classList.contains("gallery-photo")`));
    check("WA: Escape on menu didn't close the gallery", await visible(g.panel));

    // Lightbox
    await page.click(`${g.tabpanel("media")} .gallery-photo`);
    await page.waitFor(`!document.getElementById("media-modal").hidden`);
    await sleep(400);
    const sub1 = await text("#media-modal-subtitle");
    check("WA: tap opens lightbox at 1 of N", /1 of 15/.test(sub1), sub1);
    check("WA: lightbox focus on close button", (await active()) === "media-modal-close");
    check("WA: lightbox has prev/next", await visible("#media-modal .media-nav-next") && await page.eval(`document.querySelector("#media-modal .media-nav-prev").disabled`));
    await page.key("ArrowRight", { code: "ArrowRight", keyCode: 39 });
    await sleep(300);
    check("WA: → steps to 2 of N", /2 of 15/.test(await text("#media-modal-subtitle")));
    await page.click("#media-modal .media-nav-prev");
    await sleep(300);
    check("WA: prev button steps back", /1 of 15/.test(await text("#media-modal-subtitle")));
    await page.key("End", { code: "End", keyCode: 35 });
    await sleep(300);
    check("WA: End jumps to last; next disabled", /15 of 15/.test(await text("#media-modal-subtitle")) && await page.eval(`document.querySelector("#media-modal .media-nav-next").disabled`));
    await page.key("Home", { code: "Home", keyCode: 36 });
    await sleep(300);
    // swipe left on the stage
    const stage = await page.center("#media-modal .media-stage");
    await page.touch("touchStart", [[stage.x + 120, stage.y]]);
    for (let i = 1; i <= 4; i++) { await sleep(25); await page.touch("touchMove", [[stage.x + 120 - i * 60, stage.y + 4]]); }
    await page.touch("touchEnd", []);
    await sleep(400);
    check("WA: swipe left goes to next", /2 of 15/.test(await text("#media-modal-subtitle")));
    for (let i = 0; i < 7; i++) await page.key("Tab", { code: "Tab", keyCode: 9 });
    check("WA: Tab stays inside the lightbox", await page.eval(`document.getElementById("media-modal").contains(document.activeElement)`));
    check("WA: lightbox subtitle shows sender and date", /Bob Jones|Alice Smith|Carol Diaz|Dave Lee|محمد/.test(await text("#media-modal-subtitle")) && /2024/.test(await text("#media-modal-subtitle")));
    await page.key("Escape");
    await sleep(300);
    check("WA: Escape closes lightbox, gallery stays", (await page.eval(`document.getElementById("media-modal").hidden`)) && await visible(g.panel));
    check("WA: focus returns to the photo's tile", await page.eval(`document.activeElement?.classList.contains("gallery-photo")`));
    // Back button from the lightbox
    await page.click(`${g.tabpanel("media")} .gallery-photo`);
    await page.waitFor(`!document.getElementById("media-modal").hidden`);
    await page.eval(`history.back()`);
    await sleep(500);
    check("WA: Back closes lightbox only", (await page.eval(`document.getElementById("media-modal").hidden`)) && await visible(g.panel));
    await page.eval(`history.back()`);
    await sleep(400);
    check("WA: Back again closes the gallery", !(await visible(g.panel)));
    check("WA: chat no longer inert", await page.eval(`!document.getElementById("viewport").inert`));

    // Jump to message (right-click → menu)
    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    await page.waitFor(`document.querySelectorAll("#gallery-tabpanel-media .gallery-photo").length > 5`);
    await page.rightClick(`${g.tabpanel("media")} li:nth-child(4) .gallery-photo`);
    check("WA: right-click opens menu", await visible(g.menu));
    await page.click(`${g.menu} [data-gallery-action=jump]`);
    await sleep(300);
    check("WA: Jump closes the gallery", !(await visible(g.panel)));
    const flash = await page.eval(`(() => { const row = document.querySelector("#message-list .msg-row.msg-flash"); if (!row) return null; const r = row.getBoundingClientRect(), v = document.getElementById("viewport").getBoundingClientRect();
        return { inView: r.top >= v.top - 2 && r.bottom <= v.bottom + 2, hasMedia: !!row.querySelector("[data-media-id]"), focused: document.activeElement === row }; })()`);
    check("WA: target message highlighted, in view, focused", flash && flash.inView && flash.hasMedia && flash.focused, JSON.stringify(flash));
    await page.screenshot("wa-jump-flash");
    await sleep(2100);
    check("WA: highlight fades", (await count("#message-list .msg-flash")) === 0);
    check("WA: history clean after jump (Back leaves nothing open)", await page.eval(`!history.state?.overlay`));

    // Links tab via keyboard
    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    await page.key("ArrowRight", { code: "ArrowRight", keyCode: 39 });
    await sleep(200);
    check("WA: → moves to Links tab (selected + focused)", (await active()) === "gallery-tab-links" && await page.eval(`document.getElementById("gallery-tab-links").getAttribute("aria-selected") === "true"`));
    check("WA: links open safely (target _blank, noopener noreferrer, http(s))", await page.eval(`[...document.querySelectorAll("#gallery-tabpanel-links a.gallery-link")].every((a) => a.target === "_blank" && /noopener/.test(a.rel) && /noreferrer/.test(a.rel) && /^https?:/.test(a.href))`));
    check("WA: injected link stays one inert link", await page.eval(`!document.querySelector("#gallery-panel [onmouseover], #gallery-panel script, #gallery-panel svg[onload]")`));
    check("WA: Hebrew sender shown with bidi isolation", await page.eval(`[...document.querySelectorAll("#gallery-tabpanel-links .gallery-meta bdi")].some((b) => b.textContent === "שרה כהן")`));
    let before = (await pageTargets()).length;
    await page.longPress(`${g.tabpanel("links")} li:nth-child(1) .gallery-link`, 650);
    check("WA: long-press on a link opens the menu", await visible(g.menu));
    check("WA: long-press did not open the link", (await pageTargets()).length === before);
    await page.key("Escape");
    await page.longPress(`${g.tabpanel("links")} li:nth-child(2) .gallery-link`, 650, [0, 70]);
    check("WA: press that moves (scroll) never opens the menu", !(await visible(g.menu)));
    before = (await pageTargets()).length;
    await page.tap(`${g.tabpanel("links")} li:nth-child(1) .gallery-link`);
    await sleep(600);
    check("WA: tap opens the link in a new tab", (await pageTargets()).length === before + 1);
    await closeExtraTargets(mainTarget);
    await page.eval(`document.querySelector("#gallery-tabpanel-links .gallery-link").focus()`);
    await page.key("F10", { code: "F10", keyCode: 121, modifiers: 8 });
    check("WA: Shift+F10 opens the menu from the keyboard", await visible(g.menu));
    await page.key("Escape");
    check("WA: …and Escape returns focus to the link", await page.eval(`document.activeElement?.classList.contains("gallery-link")`));

    // Docs: voice notes play inline, documents open
    await page.click(g.tab("docs"));
    await sleep(200);
    check("WA: docs list has 7 voice/audio rows + 3 documents", (await count(`${g.tabpanel("docs")} .gallery-voice`)) === 7 && (await count(`${g.tabpanel("docs")} .gallery-doc`)) === 3);
    check("WA: injection file name shown as text", await page.eval(`[...document.querySelectorAll("#gallery-tabpanel-docs .gallery-link-title")].some((t) => t.textContent.includes('<svg onload=confirm'))`) && !(await page.eval(`!!document.querySelector("svg[onload]")`)));
    const voiceRows = await count(`${g.tabpanel("docs")} .gallery-voice`);
    let played = 0;
    for (let i = 1; i <= voiceRows; i++) {
        const sel = `${g.tabpanel("docs")} li:has(.gallery-voice):nth-of-type(${i}) .gallery-voice`;
        const exists = await page.eval(`!!document.querySelectorAll("#gallery-tabpanel-docs .gallery-voice")[${i - 1}]`);
        if (!exists) continue;
        await page.eval(`document.querySelectorAll("#gallery-tabpanel-docs .gallery-voice")[${i - 1}].click()`);
        const ok = await page.waitFor(`(() => { const r = document.querySelectorAll("#gallery-tabpanel-docs .gallery-voice")[${i - 1}]; return r.getAttribute("aria-pressed") === "true" && /\\d:\\d\\d/.test(r.querySelector(".gallery-voice-time").textContent); })()`, { timeout: 6000 }).then(() => true, () => false);
        if (ok) played++;
    }
    check(`WA: every voice note plays inline (opus, ogg, m4a, mp4) ${played}/${voiceRows}`, played === voiceRows);
    const lastIdx = voiceRows - 1;
    await sleep(500);
    check("WA: progress advances while playing", await page.eval(`parseFloat(document.querySelectorAll("#gallery-tabpanel-docs .gallery-voice")[${lastIdx}].querySelector(".gallery-voice-progress").style.width) > 0`));
    check("WA: only one note plays at a time", (await count(`${g.tabpanel("docs")} .gallery-voice[aria-pressed=true]`)) === 1);
    await page.eval(`document.querySelectorAll("#gallery-tabpanel-docs .gallery-voice")[${lastIdx}].click()`);
    await sleep(300);
    check("WA: tapping again pauses", (await count(`${g.tabpanel("docs")} .gallery-voice[aria-pressed=true]`)) === 0);
    await page.screenshot("wa-gallery-docs");
    await page.eval(`[...document.querySelectorAll("#gallery-tabpanel-docs .gallery-doc")].find((d) => /Trip plan/.test(d.textContent)).click()`);
    await page.waitFor(`!!document.querySelector("#media-modal-body .media-doc")`);
    check("WA: a document opens in the viewer with download", await page.eval(`!!document.querySelector("#media-modal-body .media-doc a[download]")`));
    await page.key("Escape");
    await sleep(300);

    // Anonymize while the gallery is open
    await page.click("#menu-toggle");
    await page.click("#anonymize-toggle");
    await sleep(500);
    const galleryDump = async () => page.eval(`(() => { const p = document.getElementById("gallery-panel"); const lb = document.getElementById("media-modal");
        return p.outerHTML.replace(/ href="[^"]*"/g, "") + [...p.querySelectorAll("[aria-label],[title]")].map((e) => e.getAttribute("aria-label") + e.getAttribute("title")).join(" "); })()`);
    let dump = "";
    for (const tab of ["media", "links", "docs"]) { await page.click(g.tab(tab)); await sleep(250); dump += await galleryDump(); }
    check("WA: gallery stays open across Anonymize toggle", await visible(g.panel));
    check("WA: anonymized gallery leaks no names/numbers (labels, text, file names)", leaks(dump, WA_SECRETS).length === 0, leaks(dump, WA_SECRETS).join(", "));
    check("WA: anonymized gallery shows aliases", /Person [A-Z]/.test(dump));
    await page.click(g.tab("media"));
    await page.click(`${g.tabpanel("media")} .gallery-photo`);
    await page.waitFor(`!document.getElementById("media-modal").hidden`);
    await sleep(400);
    const lbText = await page.eval(`document.getElementById("media-modal").innerText + document.getElementById("media-download-link").download`);
    check("WA: anonymized lightbox caption leaks nothing", leaks(lbText, WA_SECRETS).length === 0, lbText);
    await page.key("Escape");
    await sleep(300);
    await page.key("Escape");
    await sleep(300);
    check("WA: Escape closes the gallery, focus back on the menu button", !(await visible(g.panel)) && (await active()) === "menu-toggle");
    await sleep(400);
    check("WA: no orphaned blob URLs after closing the gallery", (await page.eval(ORPHANS("#message-list"))) === 0, String(await page.eval(ORPHANS("#message-list"))));
    await page.click("#anonymize-banner-off");

    // Names inside URLs: href untouched, visible text masked (bubbles + gallery)
    await loadAnother("WhatsApp Chat with Link Names.zip");
    await page.waitFor(`/3 messages/.test(document.getElementById("header-meta").textContent)`);
    await sleep(700);
    await page.click("#menu-toggle");
    await page.click("#anonymize-toggle");
    await sleep(400);
    const bubbleLinks = await page.eval(`[...document.querySelectorAll("#message-list a[href]")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent }))`);
    const ORIGINAL = ["https://example.com/u/Alice%20Smith/919876543210", "https://example.com/people/Bob_Jones?ref=bob.jones@example.com"];
    check("WA: bubble links keep their exact href in Anonymize", JSON.stringify(bubbleLinks.map((l) => l.href)) === JSON.stringify(ORIGINAL), JSON.stringify(bubbleLinks));
    check("WA: bubble link text is masked and not split", bubbleLinks.length === 2 && leaks(bubbleLinks.map((l) => l.text).join(" "), [/Alice/, /Smith/, /919876543210/, /Bob/, /Jones/, /bob\.jones/]).length === 0, JSON.stringify(bubbleLinks.map((l) => l.text)));
    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    await page.click(g.tab("links"));
    await sleep(200);
    const galleryLinks = await page.eval(`[...document.querySelectorAll("#gallery-tabpanel-links a")].map((a) => ({ href: a.getAttribute("href"), text: a.innerText }))`);
    check("WA: gallery links keep exact href, visible text masked", galleryLinks.length === 2 && galleryLinks.every((l) => ORIGINAL.includes(l.href)) && leaks(galleryLinks.map((l) => l.text).join(" "), [/Alice/, /Smith/, /919876543210/, /Bob/, /Jones/, /bob\.jones/]).length === 0, JSON.stringify(galleryLinks));
    await page.key("Escape");
    await page.click("#anonymize-banner-off");

    // .txt export: <Media omitted> empty states
    await loadAnother("WhatsApp Chat with Weekend Hikers.txt");
    await page.waitFor(`/messages/.test(document.getElementById("header-meta").textContent) && !/media/.test(document.getElementById("header-meta").textContent) || document.getElementById("header-name").textContent === "Weekend Hikers"`);
    await sleep(400);
    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    const emptyMedia = await text(`${g.tabpanel("media")} .gallery-empty`);
    check("WA .txt: Media tab explains <Media omitted>", /Media omitted/.test(emptyMedia) && /Attach media/.test(emptyMedia), emptyMedia);
    check("WA .txt: empty state links to export help", await page.eval(`!!document.querySelector("#gallery-tabpanel-media .gallery-empty a[href='how-to-export.html']")`));
    await page.click(g.tab("docs"));
    check("WA .txt: Docs tab explains it too", /Media omitted/.test(await text(`${g.tabpanel("docs")} .gallery-empty`)));
    await page.click(g.tab("links"));
    check("WA .txt: Links still listed", (await count(`${g.tabpanel("links")} .gallery-link`)) === 6);
    await page.screenshot("wa-gallery-empty-txt");
    await page.key("Escape");

    // Huge chat: 60k messages
    await loadAnother("WhatsApp Chat with Huge Group.txt");
    await page.waitFor(`/60,000 messages|60000 messages|60.000/.test(document.getElementById("header-meta").textContent)`, { timeout: 60000 });
    await sleep(500);
    const t0 = Date.now();
    await openGallery("#menu-toggle", "#gallery-action", g.panel);
    await page.click(g.tab("links"));
    const openMs = Date.now() - t0;
    check(`WA huge: opens + Links tab in ${openMs}ms (< 2500)`, openMs < 2500);
    check("WA huge: Links count 1,200", (await text(`[data-gallery-count=links]`)).replace(/\D/g, "") === "1200");
    check("WA huge: first page only (40 rows in DOM)", (await count(`${g.tabpanel("links")} .gallery-link`)) === 40);
    for (let i = 0; i < 6; i++) { await page.eval(`(() => { const s = document.getElementById("gallery-scroll"); s.scrollTop = s.scrollHeight; })()`); await sleep(250); }
    const afterScroll = await count(`${g.tabpanel("links")} .gallery-link`);
    check(`WA huge: scrolling loads more pages (${afterScroll})`, afterScroll > 80 && afterScroll <= 1200);
    await page.eval(`document.querySelector("#gallery-tabpanel-links [data-gallery-more]")?.focus()`);
    const hadMore = await page.eval(`!!document.activeElement?.matches("[data-gallery-more]")`);
    if (hadMore) {
        const n = await count(`${g.tabpanel("links")} .gallery-link`);
        await page.key("Enter", { code: "Enter", keyCode: 13 });
        await sleep(200);
        check("WA huge: Show more by keyboard moves focus to a newly loaded row", await page.eval(`document.activeElement?.classList.contains("gallery-link") && Number(document.activeElement.dataset.galleryIndex) >= ${n}`));
    }
    await page.longPress(`${g.tabpanel("links")} li:nth-child(5) .gallery-link`, 650);
    await page.click(`${g.menu} [data-gallery-action=jump]`);
    await sleep(300);
    check("WA huge: Jump works deep in a 60k chat", await page.eval(`!!document.querySelector("#message-list .msg-row.msg-flash a[href*='example.com/p/']")`));
    await page.click("#menu-toggle");
    await page.click("#gallery-action");
    await sleep(200);
    await page.click(g.tab("media"));
    check("WA huge: Media tab says media was omitted", /Media omitted/.test(await text(`${g.tabpanel("media")} .gallery-empty`)));

    // Mobile layout, both themes
    await page.viewport(390, 844, { mobile: true, touch: true });
    await sleep(400);
    check("WA mobile: no horizontal overflow", await page.eval(`(() => { const p = document.getElementById("gallery-panel"); return p.scrollWidth <= p.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; })()`));
    await page.click(g.tab("links"));
    await page.screenshot("wa-gallery-mobile-dark");
    await page.eval(`document.body.classList.add("light-theme")`);
    await sleep(200);
    await page.screenshot("wa-gallery-mobile-light");
    await page.eval(`document.body.classList.remove("light-theme")`);
    await page.key("Escape");
    await page.viewport(1280, 860);

    // ═══ Instagram ══════════════════════════════════════════════════════════
    const ig = G("ig-gallery");
    await page.goto(`${BASE}/public/instagram-viewer.html`);
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-test.zip");
    await page.waitFor(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length > 0`);
    const threadCount = await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length`);
    let dmOpen = false;
    for (let i = 0; i < threadCount && !dmOpen; i++) {
        await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]")[${i}].click()`);
        await sleep(900);
        dmOpen = await page.eval(`/media/.test(document.getElementById("ig-header-meta").textContent)`);
        if (!dmOpen) { await page.eval(`document.getElementById("ig-change-thread")?.click()`); await sleep(400); }
    }
    check("IG: DM thread opened", dmOpen);
    for (let i = 0; i < 6; i++) { await page.eval(`document.getElementById("ig-viewport").scrollTop = 0`); await sleep(120); }
    check("IG: voice notes (.mp4 in audio_files) render as audio, not video", (await count("#ig-message-list .ig-voice-note audio")) === 2);
    const reel = await page.eval(`(() => { const c = document.querySelector("#ig-message-list .ig-share-card.ig-share-reel"); return c && { href: c.getAttribute("href"), text: c.innerText, rel: c.rel, target: c.target }; })()`);
    check("IG: shared reel shows a cover card (kind, owner, caption)", reel && /Reel/i.test(reel.text) && /@bobjones_travels/.test(reel.text) && /Best café/.test(reel.text) && reel.href === "https://www.instagram.com/reel/REEL42/?igsh=abc" && /noopener/.test(reel.rel) && reel.target === "_blank", JSON.stringify(reel));
    check("IG: shared post card too", (await count("#ig-message-list .ig-share-card.ig-share-post")) === 1);
    check("IG: script in caption stays text", (await page.eval(`!document.querySelector("#ig-message-list script")`)) && /<script>/.test(reel?.text || ""));
    await page.eval(`document.querySelector("#ig-message-list .ig-share-card")?.scrollIntoView({ block: "center" })`);
    await page.screenshot("ig-reel-cards");

    await openGallery("#ig-menu-toggle", "#ig-gallery-action", ig.panel);
    check("IG: tabs are Media and Docs only (no Links)", JSON.stringify(await page.eval(`[...document.querySelectorAll("#ig-gallery-panel [role=tab]")].map((t) => t.querySelector("span").textContent)`)) === '["Media","Docs"]');
    const igCounts = await page.eval(`[...document.querySelectorAll("#ig-gallery-panel [data-gallery-count]")].map((c) => c.textContent)`);
    check("IG: counts media 7 (6 photos + video) / docs 3 (2 voice + pdf)", JSON.stringify(igCounts) === '["7","3"]', JSON.stringify(igCounts));
    check("IG: missing photo noted", /isn't in this export/.test(await text(`${ig.tabpanel("media")} .gallery-notice`)));
    await page.click(ig.tab("docs"));
    await sleep(200);
    await page.eval(`document.querySelector("#ig-gallery-tabpanel-docs .gallery-voice").click()`);
    const igPlayed = await page.waitFor(`document.querySelector("#ig-gallery-tabpanel-docs .gallery-voice").getAttribute("aria-pressed") === "true"`, { timeout: 6000 }).then(() => true, () => false);
    check("IG: .mp4 voice note plays inline", igPlayed);
    await page.eval(`document.querySelector("#ig-gallery-tabpanel-docs .gallery-voice").click()`);
    await page.click(ig.tab("media"));
    await page.waitFor(`document.querySelectorAll("#ig-gallery-tabpanel-media .gallery-photo.loaded").length >= 4`, { timeout: 15000 });
    await page.click(`${ig.tabpanel("media")} .gallery-photo`);
    await page.waitFor(`!document.getElementById("ig-media-modal").hidden`);
    await page.key("ArrowRight", { code: "ArrowRight", keyCode: 39 });
    await sleep(300);
    check("IG: lightbox steps with →", /2 of 7/.test(await text("#ig-media-modal-subtitle")), await text("#ig-media-modal-subtitle"));
    await page.key("Escape");
    await sleep(300);
    await page.eval(`document.querySelectorAll("#ig-gallery-tabpanel-media .gallery-photo")[1].focus()`);
    await page.key("ContextMenu", { code: "ContextMenu", keyCode: 93 });
    check("IG: Menu key opens Jump menu", await visible(ig.menu));
    await page.key("Enter", { code: "Enter", keyCode: 13 });
    await sleep(300);
    check("IG: Jump lands on the message (highlighted + focused)", await page.eval(`(() => { const r = document.querySelector("#ig-message-list .msg-row.msg-flash"); return !!r && document.activeElement === r; })()`));

    await page.click("#ig-menu-toggle");
    await page.click("#ig-anonymize-toggle");
    await sleep(400);
    const igReelAnon = await page.eval(`(() => { const c = document.querySelector("#ig-message-list .ig-share-card.ig-share-reel"); return c && { href: c.getAttribute("href"), text: c.innerText }; })()`);
    check("IG: anonymized reel card masks owner, keeps href", igReelAnon && /@\[user\]/.test(igReelAnon.text) && !/bobjones/i.test(igReelAnon.text) && igReelAnon.href === "https://www.instagram.com/reel/REEL42/?igsh=abc", JSON.stringify(igReelAnon));
    await openGallery("#ig-menu-toggle", "#ig-gallery-action", ig.panel);
    let igDump = "";
    for (const tab of ["media", "docs"]) { await page.click(ig.tab(tab)); await sleep(250); igDump += await page.eval(`(() => { const p = document.getElementById("ig-gallery-panel"); return p.outerHTML + [...p.querySelectorAll("[aria-label],[title]")].map((e) => e.getAttribute("aria-label") + e.getAttribute("title")).join(" "); })()`); }
    check("IG: anonymized gallery leaks nothing", leaks(igDump, IG_SECRETS).length === 0, leaks(igDump, IG_SECRETS).join(", "));
    await page.key("Escape");
    await page.click("#ig-anonymize-banner-off");

    // Big IG thread: 50k messages, 5,000 photos over 6 files
    await page.eval(`document.querySelector("[data-ig-another-export]")?.click()`);
    await sleep(250);
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-big.zip");
    await page.waitFor(`document.getElementById("ig-header-name").textContent === "Big Thread" || (!document.getElementById("ig-thread-panel")?.classList.contains("hidden") && /Big/.test(document.getElementById("ig-thread-list")?.textContent || ""))`, { timeout: 60000 });
    if (await page.eval(`document.getElementById("ig-header-name").textContent !== "Big Thread"`)) {
        await page.eval(`document.querySelector("#ig-thread-list [data-thread-idx]").click()`);
        await page.waitFor(`document.getElementById("ig-header-name").textContent === "Big Thread"`, { timeout: 60000 });
    }
    await sleep(500);
    const t1 = Date.now();
    await openGallery("#ig-menu-toggle", "#ig-gallery-action", ig.panel);
    const igOpenMs = Date.now() - t1;
    check(`IG big: opens in ${igOpenMs}ms (< 2500)`, igOpenMs < 2500);
    check("IG big: media count 5,000", (await text(`#ig-gallery-panel [data-gallery-count=media]`)).replace(/\D/g, "") === "5000");
    const firstPage = await count(`${ig.tabpanel("media")} .gallery-photo`);
    console.log("first page tiles:", firstPage);
    check("IG big: renders in pages, not all 5,000 tiles", firstPage >= 60 && firstPage <= 240 && firstPage % 60 === 0, String(firstPage));
    for (let i = 0; i < 12; i++) { await page.eval(`(() => { const s = document.getElementById("ig-gallery-scroll"); s.scrollTop = s.scrollHeight; })()`); await sleep(200); }
    const tiles = await count(`${ig.tabpanel("media")} .gallery-photo`);
    const withSrc = await count(`${ig.tabpanel("media")} img[src]`);
    check(`IG big: pages load as you scroll (${tiles} tiles)`, tiles > 300);
    check(`IG big: far-away thumbnails are released (${withSrc} of ${tiles} hold a src)`, withSrc < tiles / 2);
    await page.key("Escape");
    await sleep(400);
    check("IG big: no orphaned blob URLs after close", (await page.eval(ORPHANS("#ig-message-list"))) === 0, String(await page.eval(ORPHANS("#ig-message-list"))));

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
