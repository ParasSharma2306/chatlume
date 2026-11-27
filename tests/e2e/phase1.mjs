import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = "http://127.0.0.1:8765";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`); };

const WA_SECRETS = [/\bAlice\b/, /\bSmith\b/, /\bBob\b/, /\bJones\b/, /\bCarol\b/, /\bDiaz\b/, /\bDave\b/, /Weekend Hikers/, /98765/, /43210/, /bob\.jones@example\.com/, /010-0199/, /\bEve\b/, /Adams/, /onerror=alert/];
const IG_SECRETS = [/\bBob\b/, /\bJones\b/, /Zo[eë]/, /Ångström|Angstrom/, /Mallory/, /\bAnn\b/, /\bRaj\b/, /Patel/, /\bKim\b/, /\bOde\b/, /Ghost Member/, /Stranger Danger/, /bobjones/, /annrajkim/];

// Everything a person could see or a script could read: markup, form values, title.
const SNAPSHOT = `(() => {
    const values = [...document.querySelectorAll("input, select, textarea")].map((el) => el.value).join("\\n");
    return document.title + "\\n" + document.documentElement.outerHTML + "\\n" + values;
})()`;

function leaks(text, secrets) {
    // Ignore the app's own static copy (e.g. the How-to pages link text) by scanning only chat-bearing regions? No: scan everything.
    return secrets.filter((re) => re.test(text)).map(String);
}

async function captureDownloads(page) {
    await page.eval(`(() => {
        window.__downloads = [];
        const original = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            if (this.download && this.href.startsWith("blob:")) {
                window.__downloads.push({ href: this.href, name: this.download });
                return;
            }
            return original.call(this);
        };
        return true;
    })()`);
}

async function lastDownload(page) {
    return page.eval(`(async () => {
        const d = window.__downloads.at(-1);
        if (!d) return null;
        const blob = await (await fetch(d.href)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { name: d.name, type: blob.type, base64: btoa(bin) };
    })()`);
}

const { page, close } = await launch({ shots: join(OUT, "shots") });
try {
    // ── WhatsApp ────────────────────────────────────────────────────────────
    await page.goto(`${BASE}/public/viewer.html`);
    await page.waitFor(`!document.getElementById("loader") || getComputedStyle(document.getElementById("loader")).visibility === "hidden" || document.getElementById("loader").classList.contains("hide") || true`);
    await captureDownloads(page);
    await page.loadFixture("file-input", "load-chat", "WhatsApp Chat with Weekend Hikers.zip");
    await page.waitFor(`/messages/.test(document.getElementById("header-meta").textContent)`);
    await sleep(500);
    let snap = await page.eval(SNAPSHOT);
    check("WA: real names visible before anonymize", /Bob Jones/.test(snap) && /Alice/.test(snap));
    check("WA: banner hidden while off", await page.eval(`document.getElementById("anonymize-banner").hidden`));

    await page.click("#menu-toggle");
    await page.click("#anonymize-toggle");
    await sleep(400);
    check("WA: toggle reports pressed", await page.eval(`document.getElementById("anonymize-toggle").getAttribute("aria-pressed") === "true"`));
    check("WA: banner visible while on", await page.eval(`!document.getElementById("anonymize-banner").hidden && getComputedStyle(document.getElementById("anonymize-banner")).display !== "none"`));
    check("WA: header shows neutral title", (await page.eval(`document.getElementById("header-name").textContent`)) === "Group chat");

    // scroll through the whole chat so every bubble renders at least once
    for (let i = 0; i < 12; i++) { await page.eval(`document.getElementById("viewport").scrollTop = 0`); await sleep(120); }
    snap = await page.eval(SNAPSHOT);
    check("WA: DOM/values/title leak nothing (top)", leaks(snap, WA_SECRETS).length === 0, leaks(snap, WA_SECRETS).join(", "));
    await page.eval(`document.getElementById("scroll-latest").click()`);
    await sleep(300);
    snap = await page.eval(SNAPSHOT);
    check("WA: DOM/values/title leak nothing (bottom)", leaks(snap, WA_SECRETS).length === 0, leaks(snap, WA_SECRETS).join(", "));
    check("WA: placeholders present", /Person A/.test(snap) && /\[phone\]/.test(snap) && /\[email\]/.test(snap));
    check("WA: phone-number participant aliased in text", /my other number is Person/.test(snap));
    check("WA: injection rendered as text", !(await page.eval(`!!document.querySelector("#message-list script, #message-list img[src='x'], #message-list [onerror], #message-list [onmouseover]")`)));
    await page.screenshot("wa-anonymized-desktop");

    // Analytics, settings, Wrapped, media modal
    await page.click("#open-stats");
    await sleep(500);
    await page.click("#generate-wrapped");
    await sleep(500);
    snap = await page.eval(SNAPSHOT);
    check("WA: Wrapped + analytics leak nothing", leaks(snap, WA_SECRETS).length === 0, leaks(snap, WA_SECRETS).join(", "));
    await page.screenshot("wa-wrapped-anonymized");
    await page.key("Escape");
    await sleep(300);
    await page.key("Escape");
    await sleep(300);
    const opened = await page.eval(`(() => { const b = document.querySelector("#message-list [data-open-media]"); if (!b) return false; b.click(); return true; })()`);
    await sleep(800);
    snap = await page.eval(SNAPSHOT);
    check("WA: media modal leaks nothing", opened && leaks(snap, WA_SECRETS).length === 0, leaks(snap, WA_SECRETS).join(", "));
    await page.key("Escape");
    await sleep(300);

    // Search sees what is on screen
    await page.click("#search-toggle");
    await page.eval(`(() => { const i = document.getElementById("live-search"); i.value = "jones"; i.dispatchEvent(new Event("input")); })()`);
    await sleep(400);
    check("WA: searching a hidden name finds nothing", /No matches/.test(await page.eval(`document.getElementById("search-counter").textContent`)));
    await page.eval(`(() => { const i = document.getElementById("live-search"); i.value = "Person B"; i.dispatchEvent(new Event("input")); })()`);
    await sleep(400);
    check("WA: searching an alias finds matches", /\d+\/\d+/.test(await page.eval(`document.getElementById("search-counter").textContent`)));
    await page.click("#search-close");

    // Sender filter by alias
    await page.click("#sender-filter-btn");
    const filterValues = await page.eval(`[...document.querySelectorAll("#sender-filter-list input")].map((i) => i.value)`);
    check("WA: filter values are aliases", filterValues.every((v) => v === "" || /^Person [A-Z]+$|^You$/.test(v)), filterValues.join("|"));
    await page.eval(`(() => { const box = [...document.querySelectorAll("#sender-filter-list input")].find((i) => i.value === "Person B"); box.click(); })()`);
    await sleep(400);
    check("WA: filtering by alias works", /of \d+ messages/.test(await page.eval(`document.getElementById("header-meta").textContent`)));
    await page.click("#sender-filter-reset-btn");
    await page.key("Escape");

    // Exports
    await page.click("#menu-toggle");
    await page.click("#export-chat-btn");
    await sleep(800);
    const htmlExport = await lastDownload(page);
    const exportText = Buffer.from(htmlExport.base64, "base64").toString("utf8");
    writeFileSync(join(OUT, "wa-anon-export.html"), exportText);
    check("WA: HTML export filename anonymized", !/hikers/i.test(htmlExport.name), htmlExport.name);
    check("WA: HTML export leaks nothing", leaks(exportText, WA_SECRETS).length === 0, leaks(exportText, WA_SECRETS).join(", "));
    await page.click("#menu-toggle");
    await page.click("#export-chat-media-btn");
    await page.waitFor(`window.__downloads.length >= 2`, { timeout: 30000 });
    const zipExport = await lastDownload(page);
    const zipPath = join(OUT, "wa-anon-export.zip");
    writeFileSync(zipPath, Buffer.from(zipExport.base64, "base64"));
    const listing = execFileSync("unzip", ["-l", zipPath]).toString();
    const extracted = join(OUT, "wa-zip");
    rmSync(extracted, { recursive: true, force: true });
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", extracted]);
    const zipIndex = execFileSync("cat", [join(extracted, "index.html")]).toString();
    check("WA: ZIP export entry names leak nothing", leaks(listing, WA_SECRETS).length === 0, leaks(listing, WA_SECRETS).join(", "));
    check("WA: ZIP index.html leaks nothing", leaks(zipIndex, WA_SECRETS).length === 0, leaks(zipIndex, WA_SECRETS).join(", "));
    check("WA: ZIP carries attachments", /attachments\/\d{4}-IMG-/.test(listing));

    // Reversible without reload
    await page.click("#anonymize-banner-off");
    await sleep(400);
    snap = await page.eval(SNAPSHOT);
    check("WA: turning off restores names", /Bob Jones/.test(snap) && (await page.eval(`document.getElementById("header-name").textContent`)) === "Weekend Hikers");
    check("WA: banner hidden after off", await page.eval(`document.getElementById("anonymize-banner").hidden`));

    // Survives a reload within the session
    await page.click("#menu-toggle");
    await page.click("#anonymize-toggle");
    await page.goto(`${BASE}/public/viewer.html`);
    await captureDownloads(page);
    check("WA: preference survives reload", await page.eval(`document.getElementById("anonymize-toggle").getAttribute("aria-pressed") === "true"`));
    await page.loadFixture("file-input", "load-chat", "WhatsApp Chat with Weekend Hikers.txt");
    await page.waitFor(`/messages/.test(document.getElementById("header-meta").textContent)`);
    await sleep(400);
    snap = await page.eval(SNAPSHOT);
    check("WA: reloaded .txt chat opens anonymized", leaks(snap, WA_SECRETS).length === 0, leaks(snap, WA_SECRETS).join(", "));
    await page.viewport(375, 740, { mobile: true, touch: true });
    await sleep(300);
    await page.screenshot("wa-anonymized-mobile");
    await page.viewport(1280, 860);

    // ── Instagram ───────────────────────────────────────────────────────────
    await page.goto(`${BASE}/public/instagram-viewer.html`);
    await captureDownloads(page);
    check("IG: preference shared across viewers", await page.eval(`document.getElementById("ig-anonymize-toggle").getAttribute("aria-pressed") === "true"`));
    await page.loadFixture("ig-file-input", "ig-load-btn", "instagram-test.zip");
    await page.waitFor(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length > 0`);
    snap = await page.eval(SNAPSHOT);
    check("IG: thread picker leaks nothing while on", leaks(snap, IG_SECRETS).length === 0, leaks(snap, IG_SECRETS).join(", "));
    check("IG: thread picker hint shown", await page.eval(`!document.getElementById("ig-thread-anon-hint").hidden`));
    await page.screenshot("ig-thread-picker-anon");
    // open the DM thread (the one with photos): find by index of folder in igState is internal; click each until media exists
    const threadCount = await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]").length`);
    let opened1 = false;
    for (let i = 0; i < threadCount && !opened1; i++) {
        await page.eval(`document.querySelectorAll("#ig-thread-list [data-thread-idx]")[${i}].click()`);
        await sleep(900);
        opened1 = await page.eval(`/media/.test(document.getElementById("ig-header-meta").textContent)`);
        if (!opened1) {
            await page.eval(`document.getElementById("ig-change-thread")?.click()`);
            await sleep(400);
        }
    }
    check("IG: DM thread opened", opened1);
    for (let i = 0; i < 6; i++) { await page.eval(`document.getElementById("ig-viewport").scrollTop = 0`); await sleep(120); }
    snap = await page.eval(SNAPSHOT);
    check("IG: DOM/values/title leak nothing", leaks(snap, IG_SECRETS).length === 0, leaks(snap, IG_SECRETS).join(", "));
    check("IG: mojibake repaired (café)", /café/.test(snap));
    await page.screenshot("ig-anonymized");
    await page.click("#ig-menu-toggle");
    await page.click("#ig-export-chat-btn");
    await sleep(800);
    const igExport = await lastDownload(page);
    const igText = Buffer.from(igExport.base64, "base64").toString("utf8");
    writeFileSync(join(OUT, "ig-anon-export.html"), igText);
    check("IG: export leaks nothing", leaks(igText, IG_SECRETS).length === 0, leaks(igText, IG_SECRETS).join(", "));
    await page.click("#ig-anonymize-banner-off");
    await sleep(400);
    snap = await page.eval(SNAPSHOT);
    check("IG: turning off restores names", /Bob Jones/.test(snap));

    // ── Errors ──────────────────────────────────────────────────────────────
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
