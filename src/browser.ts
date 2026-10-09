import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { PROFILE_DIR } from "./config.ts";

// We launch the real Chrome app ourselves (no automation flags) with a separate
// profile in .browser-profile/, then attach Playwright over the DevTools port.
// This keeps "Sign in with Google" working and looks like a normal browser.
// Your password is never stored by this tool — only Chrome's own cookies.

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
];
const DEBUG_PORT = 9333;

export function chromePath(): string {
  const p = CHROME_PATHS.find((c) => existsSync(c));
  if (!p) throw new Error("Google Chrome not found in /Applications. Install Chrome first.");
  return p;
}

function baseArgs(): string[] {
  return [`--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check"];
}

/** Plain Chrome, no DevTools port — used for the one-time manual login. */
export function launchPlainChrome(url: string): ChildProcess {
  return spawn(chromePath(), [...baseArgs(), "--new-window", url], { stdio: "ignore" });
}

export interface Session {
  context: BrowserContext;
  close(): Promise<void>;
}

/** PIDs of Chrome main processes already running on our profile (e.g. the login window left open). */
function profileChromePids(): number[] {
  try {
    const out = execFileSync("pgrep", ["-f", `user-data-dir=${PROFILE_DIR}`], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

/** Gracefully quits a job-hunter Chrome left open, so we can relaunch it with the DevTools port. */
async function quitProfileChrome(): Promise<void> {
  const pids = profileChromePids();
  if (pids.length === 0) return;
  console.log("Closing the job-hunter Chrome window that was still open...");
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  const deadline = Date.now() + 10_000;
  while (profileChromePids().length > 0 && Date.now() < deadline) await sleep(300);
  if (profileChromePids().length > 0) {
    throw new Error("The job-hunter Chrome window is still open. Quit it with Cmd+Q and retry.");
  }
}

/** Real Chrome with a DevTools port, attached via Playwright — used by the collector. */
export async function openBrowser(opts: { headless: boolean }): Promise<Session> {
  await quitProfileChrome();
  const args = [...baseArgs(), `--remote-debugging-port=${DEBUG_PORT}`, "--window-size=1280,900"];
  if (opts.headless) args.push("--headless=new");
  const proc = spawn(chromePath(), [...args, "about:blank"], { stdio: "ignore" });

  let browser: Browser | undefined;
  const deadline = Date.now() + 20_000;
  while (!browser) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    } catch (err) {
      if (proc.exitCode !== null) {
        throw new Error("Chrome exited at start. Is the job-hunter Chrome window already open? Close it and retry.");
      }
      if (Date.now() > deadline) throw err;
      await sleep(500);
    }
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  return {
    context,
    async close() {
      await browser!.close().catch(() => {});
      if (proc.exitCode === null) proc.kill("SIGTERM");
    },
  };
}

export async function firstPage(ctx: BrowserContext): Promise<Page> {
  return ctx.pages()[0] ?? (await ctx.newPage());
}

export function isLoggedOutUrl(url: string): boolean {
  return /linkedin\.com\/(login|authwall|signup|uas\/login)|[?&]session_redirect=/.test(url);
}

export function isChallengeUrl(url: string): boolean {
  return /linkedin\.com\/checkpoint\//.test(url);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function randomDelay(range: { min: number; max: number }): Promise<void> {
  return sleep(range.min + Math.random() * (range.max - range.min));
}
