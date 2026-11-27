// Minimal Chrome DevTools Protocol harness: headless Chrome, temp profile, no deps.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CHROME_PATH overrides the macOS default (e.g. /usr/bin/google-chrome on Linux).
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, shots = "./shots", profileRoot } = {}) {
    const profile = mkdtempSync(join(profileRoot || tmpdir(), "cl-chrome-"));
    mkdirSync(shots, { recursive: true });
    const proc = spawn(CHROME, [
        "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
        "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio",
        "--autoplay-policy=no-user-gesture-required", "--window-size=1280,860", "about:blank"
    ], { stdio: "ignore" });
    let version;
    for (let i = 0; i < 60; i++) {
        try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(150); }
    }
    if (!version) throw new Error("Chrome did not start");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((t) => t.type === "page");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    const logs = [];
    const dialogs = [];
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ""}`)) : resolve(msg.result);
        } else if (msg.method) {
            (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
    });
    const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    on("Runtime.consoleAPICalled", (p) => logs.push({ type: p.type, text: p.args.map((a) => a.value ?? a.description ?? "").join(" ") }));
    on("Runtime.exceptionThrown", (p) => logs.push({ type: "exception", text: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text }));
    on("Log.entryAdded", (p) => logs.push({ type: `log-${p.entry.level}`, text: `${p.entry.text} ${p.entry.url || ""}` }));
    on("Page.javascriptDialogOpening", (p) => {
        dialogs.push(p.message);
        send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
    });

    const page = {
        send, logs, dialogs,
        async goto(url) {
            const loaded = new Promise((r) => on("Page.loadEventFired", r));
            await send("Page.navigate", { url });
            await loaded;
            await sleep(300);
        },
        async eval(expression) {
            const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
            if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
            return result.result.value;
        },
        async waitFor(expression, { timeout = 20000, interval = 100 } = {}) {
            const end = Date.now() + timeout;
            for (;;) {
                const value = await page.eval(expression).catch(() => false);
                if (value) return value;
                if (Date.now() > end) throw new Error(`timeout waiting for: ${expression}`);
                await sleep(interval);
            }
        },
        async viewport(width, height, { mobile = false, touch = false } = {}) {
            await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
            await send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
            await sleep(200);
        },
        async emulateDark(dark) {
            await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
        },
        async screenshot(name) {
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            const file = join(shots, `${name}.png`);
            writeFileSync(file, Buffer.from(data, "base64"));
            return file;
        },
        async center(selector) {
            const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:"nearest"}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
            if (!box) throw new Error(`no element ${selector}`);
            return box;
        },
        async mouse(type, x, y, { button = "left", clickCount = 1, buttons } = {}) {
            await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons: buttons ?? (type === "mouseReleased" || type === "mouseMoved" ? 0 : button === "right" ? 2 : 1) });
        },
        async click(selector, opts = {}) {
            const { x, y } = await page.center(selector);
            await page.mouse("mouseMoved", x, y);
            await page.mouse("mousePressed", x, y, opts);
            await page.mouse("mouseReleased", x, y, opts);
            await sleep(opts.after ?? 150);
        },
        async rightClick(selector) {
            return page.click(selector, { button: "right" });
        },
        async touch(type, points) {
            await send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })) });
        },
        async tap(selector, holdMs = 60) {
            const { x, y } = await page.center(selector);
            await page.touch("touchStart", [[x, y]]);
            await sleep(holdMs);
            await page.touch("touchEnd", []);
            await sleep(200);
        },
        async longPress(selector, holdMs = 650, move = null) {
            const { x, y } = await page.center(selector);
            await page.touch("touchStart", [[x, y]]);
            if (move) {
                for (let i = 1; i <= 5; i++) { await sleep(40); await page.touch("touchMove", [[x + (move[0] * i) / 5, y + (move[1] * i) / 5]]); }
            }
            await sleep(holdMs);
            await page.touch("touchEnd", []);
            await sleep(250);
        },
        async key(key, { code = key, keyCode = 0, modifiers = 0 } = {}) {
            // Enter needs its text for the browser to activate a focused button.
            await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(key === "Enter" ? { text: "\r" } : {}) });
            await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
            await sleep(120);
        },
        async loadFixture(inputId, buttonId, name) {
            await page.waitFor(`(() => { const l = document.getElementById("loader"); return !l || getComputedStyle(l).display === "none"; })()`);
            await page.eval(`(async () => {
                const res = await fetch("/__fixtures__/" + encodeURIComponent(${JSON.stringify(name)}));
                const blob = await res.blob();
                const file = new File([blob], ${JSON.stringify(name)}, { type: blob.type });
                const dt = new DataTransfer(); dt.items.add(file);
                const input = document.getElementById(${JSON.stringify(inputId)});
                input.files = dt.files;
                input.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
            })()`);
            await sleep(100);
            await page.click(`#${buttonId}`);
        }
    };

    return {
        page,
        async close() {
            try { ws.close(); } catch {}
            proc.kill("SIGKILL");
        }
    };
}

export { sleep };
