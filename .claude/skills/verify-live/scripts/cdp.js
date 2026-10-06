#!/usr/bin/env node
/**
 * Drive a real Azure DevOps page over the Chrome DevTools Protocol.
 *
 * Requires Node 22+ for the global WebSocket. No dependencies.
 *
 *   node cdp.js launch  --url <url> [--port 9222]
 *   node cdp.js targets [--port 9222]
 *   node cdp.js navigate --url <url>
 *   node cdp.js eval    --frame <url-substring> (--expr <js> | --file <path>)
 *   node cdp.js close
 *
 * `eval` returns whatever the expression evaluates to. Wrap objects in
 * JSON.stringify yourself -- returnByValue cannot serialise DOM nodes.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function arg(name, fallback) {
    const i = process.argv.indexOf("--" + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = arg("port", "9222");
const BASE = `http://localhost:${PORT}`;
const PROFILE = arg("profile", path.join(os.tmpdir(), "cdp-edge-profile"));

const EDGE_CANDIDATES = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpc(ws, id, method, params, sessionId) {
    return new Promise((resolve, reject) => {
        const payload = { id, method, params: params || {} };
        if (sessionId) payload.sessionId = sessionId;

        const onMessage = (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            if (message.id !== id) return;
            ws.removeEventListener("message", onMessage);
            message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
        };

        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify(payload));
        setTimeout(() => reject(new Error(method + " timed out")), 30000);
    });
}

async function connect() {
    const version = await fetch(`${BASE}/json/version`).then((r) => r.json());
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
    });
    return ws;
}

async function launch() {
    const url = arg("url", "about:blank");
    const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
    if (!edge) throw new Error("Edge not found; pass --edge <path>");

    // A throwaway profile keeps the developer's own browser session untouched.
    // On a machine signed into Entra this usually SSOs into Azure DevOps by
    // itself; if it lands on a sign-in page, the human has to sign in once.
    spawn(arg("edge", edge), [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${PROFILE}`,
        "--no-first-run",
        "--no-default-browser-check",
        // The dev server's certificate is self-signed; without this the
        // extension iframe is blocked and renders blank with no console error.
        "--ignore-certificate-errors",
        "--new-window",
        url,
    ], { detached: true, stdio: "ignore" }).unref();

    for (let i = 0; i < 30; i++) {
        await sleep(1000);
        try {
            const v = await fetch(`${BASE}/json/version`).then((r) => r.json());
            console.log("ready:", v.Browser, "profile:", PROFILE);
            return;
        } catch { /* not up yet */ }
    }
    throw new Error("browser did not expose CDP in time");
}

async function targets() {
    const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
    for (const t of list) {
        console.log(`${t.type.padEnd(7)} ${String(t.title || "").slice(0, 40).padEnd(40)} ${t.url.slice(0, 90)}`);
    }
}

async function navigate() {
    const url = arg("url");
    if (!url) throw new Error("--url required");
    const ws = await connect();
    let id = 1;
    const { targetInfos } = await rpc(ws, id++, "Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    const sessionId = (await rpc(ws, id++, "Target.attachToTarget", { targetId: page.targetId, flatten: true })).sessionId;
    await rpc(ws, id++, "Page.enable", {}, sessionId);
    await rpc(ws, id++, "Page.navigate", { url }, sessionId);
    console.log("navigated:", url);
    ws.close();
}

/**
 * Evaluate inside a frame. Extension contributions render in out-of-process
 * iframes, so they are separate CDP targets -- you cannot reach them from the
 * parent page, and Page.reload cannot be called on them.
 */
async function evaluate() {
    const frame = arg("frame");
    const file = arg("file");
    const expression = file ? fs.readFileSync(file, "utf8") : arg("expr");
    if (!expression) throw new Error("--expr or --file required");

    const ws = await connect();
    let id = 1;

    const attempts = Number(arg("retries", "20"));
    for (let i = 0; i < attempts; i++) {
        const { targetInfos } = await rpc(ws, id++, "Target.getTargets");
        const target = frame
            ? targetInfos.find((t) => t.url.indexOf(frame) >= 0)
            : targetInfos.find((t) => t.type === "page");

        if (target) {
            const sessionId = (await rpc(ws, id++, "Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
            const out = await rpc(ws, id++, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
            if (out.exceptionDetails) {
                console.error("exception:", JSON.stringify(out.exceptionDetails.exception || out.exceptionDetails));
                process.exitCode = 1;
            } else {
                const value = out.result && out.result.value;
                console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
            }
            ws.close();
            return;
        }
        await sleep(1000);
    }

    console.error(`frame matching "${frame}" not found after ${attempts}s`);
    process.exitCode = 1;
    ws.close();
}

async function close() {
    const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
    for (const t of list) {
        if (t.type === "page") await fetch(`${BASE}/json/close/${t.id}`).catch(() => {});
    }
    console.log("closed pages; the browser process may linger");
}

const commands = { launch, targets, navigate, eval: evaluate, close };
const command = commands[process.argv[2]];

if (!command) {
    console.error("usage: cdp.js launch|targets|navigate|eval|close [options]");
    process.exit(1);
}

command().catch((error) => {
    console.error("FAILED:", error.message);
    process.exit(1);
});
