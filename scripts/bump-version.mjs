#!/usr/bin/env node
/**
 * Stamps a release version everywhere it has to agree.
 *
 *   node scripts/bump-version.mjs 1.6.1
 *
 * Every locally served script, module and stylesheet URL carries a `?v=` token
 * (in HTML, in `import` specifiers, in the storage worker URL and in the
 * service worker's precache list). The token is the cache key: a page from
 * release N can only ever load release N's modules, so an update can never mix
 * a new script.js with an old storage.js. That only holds if the token is the
 * same everywhere, which is what this script — and
 * tests/release-version.test.mjs — guarantee.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
    console.error("Usage: node scripts/bump-version.mjs <major.minor.patch>");
    process.exit(1);
}

/** Files that carry either the asset token or a human-readable version. */
export const VERSIONED_FILES = [
    "index.html",
    "sponsors.html",
    "privacy.html",
    "public/404.html",
    "public/how-it-works.html",
    "public/how-to-export.html",
    "public/how-to-export-instagram.html",
    "public/how-to-use.html",
    "public/instagram-viewer.html",
    "public/viewer.html",
    "js/export.js",
    "js/instagram.js",
    "js/instagram/media.js",
    "js/instagram/parser.js",
    "js/instagram/render.js",
    "js/instagram/search.js",
    "js/instagram/session.js",
    "js/instagram/threads.js",
    "js/instagram/ui.js",
    "js/script.js",
    "js/shared/lazy-media.js",
    "js/shared/media-modal.js",
    "js/shared/splash.js",
    "js/shared/stats-panel.js",
    "js/shared/text.js",
    "js/shared/theme.js",
    "js/shared/toast.js",
    "js/shared/virtual-list.js",
    "js/storage.js",
    "js/support.js",
    "js/whatsapp/date-jump.js",
    "js/whatsapp/file-picker.js",
    "js/whatsapp/format.js",
    "js/whatsapp/media.js",
    "js/whatsapp/parser.js",
    "js/whatsapp/persistence.js",
    "js/whatsapp/render.js",
    "js/whatsapp/search.js",
    "js/whatsapp/session.js",
    "js/whatsapp/settings-store.js",
    "js/whatsapp/settings-ui.js",
    "js/whatsapp/state.js",
    "js/whatsapp/stats.js",
    "js/whatsapp/ui.js",
    "js/whatsapp/wrapped.js",
    "sw.js",
    "package.json",
    "README.md"
];

const REPLACEMENTS = [
    // Asset token on local JS/CSS URLs and module specifiers.
    [/(\.(?:js|css))\?v=\d+\.\d+\.\d+/g, `$1?v=${version}`],
    // Human-readable version strings.
    [/const APP_VERSION = "\d+\.\d+\.\d+"/, `const APP_VERSION = "${version}"`],
    [/const IG_APP_VERSION = "\d+\.\d+\.\d+"/, `const IG_APP_VERSION = "${version}"`],
    [/const CACHE_NAME = 'chatlume-v\d+\.\d+\.\d+'/, `const CACHE_NAME = 'chatlume-v${version}'`],
    [/data-app-version>v\d+\.\d+\.\d+</g, `data-app-version>v${version}<`],
    [/Version \d+\.\d+\.\d+ &nbsp;/g, `Version ${version} &nbsp;`],
    [/ChatLume HTML Export \(v\d+\.\d+\.\d+\)/, `ChatLume HTML Export (v${version})`],
    [/badge\/version-v\d+\.\d+\.\d+-/, `badge/version-v${version}-`],
    [/"version": "\d+\.\d+\.\d+"/, `"version": "${version}"`]
];

let touched = 0;
for (const relative of VERSIONED_FILES) {
    const path = resolve(root, relative);
    const before = readFileSync(path, "utf8");
    let after = before;
    for (const [pattern, replacement] of REPLACEMENTS) {
        after = after.replace(pattern, replacement);
    }
    if (after !== before) {
        writeFileSync(path, after);
        touched += 1;
        console.log(`updated ${relative}`);
    }
}
console.log(`${touched} file(s) now at v${version}`);
