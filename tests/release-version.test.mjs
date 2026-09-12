import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

/**
 * Every locally served script, module and stylesheet must carry the same
 * release token, and the service worker must precache every one of them under
 * that token. Otherwise a page from one release could load a module from
 * another — the exact failure the token exists to rule out.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const sw = read("sw.js");
const VERSION = sw.match(/const CACHE_NAME = 'chatlume-v(\d+\.\d+\.\d+)'/)?.[1];

const HTML_PAGES = [
    "index.html", "sponsors.html", "privacy.html",
    "public/404.html", "public/how-it-works.html", "public/how-to-export.html",
    "public/how-to-export-instagram.html", "public/how-to-use.html",
    "public/instagram-viewer.html", "public/viewer.html"
];
const JS_FILES = readdirSync(resolve(root, "js")).filter((name) => name.endsWith(".js")).map((name) => `js/${name}`);

describe(`release token v${VERSION}`, () => {
    test("service worker declares a semantic version", () => {
        assert.match(VERSION || "", /^\d+\.\d+\.\d+$/);
    });

    test("human-readable versions agree with the service worker", () => {
        assert.equal(read("js/script.js").match(/const APP_VERSION = "([^"]+)"/)[1], VERSION);
        assert.equal(read("js/instagram.js").match(/const IG_APP_VERSION = "([^"]+)"/)[1], VERSION);
        assert.equal(JSON.parse(read("package.json")).version, VERSION);
        for (const page of ["public/viewer.html", "public/instagram-viewer.html"]) {
            assert.equal(read(page).match(/data-app-version>v([^<]+)</)[1], VERSION, page);
        }
    });

    test("every local script and stylesheet URL in the HTML carries the token", () => {
        for (const page of HTML_PAGES) {
            const html = read(page);
            const urls = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
            const local = urls.filter((url) => !/^(?:https?:)?\/\//.test(url) && /\.(?:js|css)(?:\?|$)/.test(url));
            assert.ok(local.length > 0, `${page} should reference local assets`);
            for (const url of local) {
                assert.ok(url.endsWith(`?v=${VERSION}`), `${page}: ${url}`);
            }
        }
    });

    test("every relative import and worker URL inside the modules carries the token", () => {
        for (const file of JS_FILES) {
            const source = read(file);
            const specifiers = [
                ...[...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
                ...[...source.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((m) => m[1]),
                ...[...source.matchAll(/new URL\(\s*["']([^"']+)["']/g)].map((m) => m[1])
            ].filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"));
            for (const specifier of specifiers) {
                assert.ok(specifier.endsWith(`?v=${VERSION}`), `${file}: ${specifier}`);
            }
        }
    });

    test("the service worker precaches every module and the stylesheet under the token", () => {
        const cached = new Set([...sw.matchAll(/versioned\('([^']+)'\)/g)].map((m) => m[1]));
        for (const file of JS_FILES) {
            assert.ok(cached.has(file), `${file} missing from ASSETS_TO_CACHE`);
        }
        assert.ok(cached.has("css/style.css"));
        // and nothing versioned is listed without the helper
        assert.equal(sw.match(/'(?:js|css)\/[^']+\.(?:js|css)'\s*,/g), null, "untagged JS/CSS entry in ASSETS_TO_CACHE");
    });

    test("versioned assets are served cache-first and the worker waits for the page's go-ahead", () => {
        assert.match(sw, /function handleVersionedAsset/);
        assert.match(sw, /SKIP_WAITING/);
        const installStart = sw.indexOf("addEventListener('install'");
        const installEnd = sw.indexOf("addEventListener(", installStart + 1);
        assert.ok(installStart > 0 && installEnd > installStart);
        assert.doesNotMatch(sw.slice(installStart, installEnd), /skipWaiting/, "install must not skipWaiting");
        assert.match(sw.slice(sw.indexOf("addEventListener('message'")), /SKIP_WAITING[\s\S]*?self\.skipWaiting\(\)/);
    });

    test("bump script targets every file that carries the version", () => {
        const script = read("scripts/bump-version.mjs");
        for (const page of [...HTML_PAGES, "js/script.js", "js/instagram.js", "js/storage.js", "sw.js", "package.json"]) {
            assert.ok(script.includes(`"${page}"`), `${page} not listed in bump-version.mjs`);
        }
    });
});
