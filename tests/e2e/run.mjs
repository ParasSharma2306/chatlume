#!/usr/bin/env node
/**
 * Browser suites: headless Chrome against the real viewers, served from this
 * checkout at http://127.0.0.1:8765, with generated fixtures (no real chats).
 *
 *   npm run test:e2e                 # every phase
 *   npm run test:e2e -- phase3       # just one
 *   npm run test:e2e -- --regen      # rebuild the fixtures first
 *
 * Needs Google Chrome (CHROME_PATH to override), python3 and ffmpeg (only to
 * build the fixtures, once). Exits non-zero if any check fails.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const fixtures = join(here, "fixtures", "out");
const args = process.argv.slice(2);
const regen = args.includes("--regen");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const phases = readdirSync(here).filter((name) => /^phase\d+\.mjs$/.test(name)).sort()
    .filter((name) => !wanted.length || wanted.some((w) => name.startsWith(w)));

const generator = join(here, "fixtures", "gen.py");
const stale = !existsSync(join(fixtures, "instagram-test.zip"))
    || statSync(generator).mtimeMs > statSync(join(fixtures, "instagram-test.zip")).mtimeMs;
if (regen || stale) {
    console.log("Building fixtures…");
    const built = spawnSync("python3", ["-I", generator, fixtures], { stdio: "inherit" });
    if (built.status !== 0) process.exit(built.status || 1);
}

const server = spawn("python3", [join(here, "devserver.py"), repo, fixtures, "8765"], { stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 50; i++) {
    try { await fetch("http://127.0.0.1:8765/public/viewer.html"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

let failed = 0;
for (const phase of phases) {
    console.log(`\n── ${phase} ──`);
    const run = spawnSync(process.execPath, [join(here, phase)], { stdio: "inherit", cwd: here });
    if (run.status !== 0) failed += 1;
}
stop();
console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${phases.length} suite(s) passed`);
process.exit(failed ? 1 : 0);
