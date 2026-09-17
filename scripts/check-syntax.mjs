#!/usr/bin/env node
/**
 * `node --check` on every script the app ships.
 *
 *   npm run check
 *
 * Walks js/ recursively (plus sw.js) so a new module can't be forgotten the
 * way a hand-maintained list in package.json could.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .js file under `dir`, relative to the repo root, sorted. */
export function listScripts(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const path = resolve(dir, name);
        if (statSync(path).isDirectory()) {
            out.push(...listScripts(path));
        } else if (name.endsWith(".js")) {
            out.push(relative(root, path).split("\\").join("/"));
        }
    }
    return out.sort();
}

const files = [...listScripts(resolve(root, "js")), "sw.js"];
let failed = 0;
for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", resolve(root, file)], { stdio: "inherit" });
    if (result.status !== 0) {
        failed += 1;
        console.error(`syntax error: ${file}`);
    }
}

if (failed) {
    console.error(`${failed} of ${files.length} file(s) failed`);
    process.exit(1);
}
console.log(`${files.length} files OK`);
