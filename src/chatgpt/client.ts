// Drives chatgpt.com in a browser tab: paste a prompt, wait for the reply, read it back.
// The reply is read with ChatGPT's own "Copy response" button (exact markdown, no DOM guessing);
// the clipboard call is captured in the page so your real clipboard is never touched.
import type { BrowserContext, Page } from "playwright";
import { sleep } from "../browser.ts";

const HOME = "https://chatgpt.com/";
const COMPOSER = 'textarea[name="prompt"]:visible, #prompt-textarea:visible';
const STOP_BUTTON = 'button[aria-label="Stop generating"], button[data-testid="stop-button"]';
const COPY_RESPONSE = 'button[aria-label="Copy response"], button[data-testid="copy-turn-action-button"]';

/** ChatGPT refused or limited us — stop sending for this run. */
export class ChatGptLimitError extends Error {}
/** This chat is too long / broken — a new chat should fix it. */
export class ChatGptChatError extends Error {}

const HOOK_CLIPBOARD = `(() => {
  if (window.__jhGpt) return;
  window.__jhGpt = [];
  const cb = navigator.clipboard;
  cb.writeText = (t) => { window.__jhGpt.push(String(t)); return Promise.resolve(); };
  cb.write = async (items) => {
    for (const it of items) {
      if (it.types.includes("text/plain")) window.__jhGpt.push(await (await it.getType("text/plain")).text());
    }
  };
})()`;

const LIMIT_RE = /reached (?:the|your|our) (?:limit|message limit)|usage limit|too many requests|you've hit the|log in to continue|sign up to continue/i;
const CHAT_ERROR_RE = /conversation is too long|maximum context|something went wrong|error in message stream|network error/i;

export class ChatGpt {
  private page!: Page;
  private turns = 0;

  constructor(
    private context: BrowserContext,
    private opts: { maxTurnsPerChat: number; replyTimeoutMs: number },
  ) {}

  async open(): Promise<void> {
    this.page = await this.context.newPage();
    await this.newChat();
  }

  async newChat(): Promise<void> {
    await this.page.goto(HOME, { waitUntil: "domcontentloaded" });
    await this.page.locator(COMPOSER).first().waitFor({ timeout: 30_000 });
    await this.page.evaluate(HOOK_CLIPBOARD);
    this.turns = 0;
  }

  /** Sends one prompt and returns the reply text. Starts a new chat when the current one is "full". */
  async ask(prompt: string): Promise<string> {
    if (this.turns >= this.opts.maxTurnsPerChat) await this.newChat();
    try {
      return await this.send(prompt);
    } catch (err) {
      if (!(err instanceof ChatGptChatError)) throw err;
      await this.newChat(); // context full / broken chat: one retry in a fresh chat
      return this.send(prompt);
    }
  }

  private async send(prompt: string): Promise<string> {
    const page = this.page;
    await page.keyboard.press("Escape").catch(() => {}); // close "log in" nudges
    await page.evaluate(HOOK_CLIPBOARD);
    // Mark the replies already on the page; the new reply is the one whose Copy button isn't marked.
    // (Counting buttons fails in long chats because ChatGPT unmounts older messages.)
    await page.evaluate(`document.querySelectorAll('${COPY_RESPONSE.replace(/'/g, "\\'")}').forEach((b) => b.setAttribute("data-jh-old", "1"))`);
    const newCopy = page.locator(COPY_RESPONSE.split(", ").map((sel) => `${sel}:not([data-jh-old])`).join(", "));

    const composer = page.locator(COMPOSER).first();
    await composer.fill(prompt);
    await sleep(300 + Math.random() * 500);
    await composer.press("Enter");
    this.turns++;

    // Done when "Stop generating" is gone and the new reply's "Copy response" button exists.
    const deadline = Date.now() + this.opts.replyTimeoutMs;
    let sawNewReply = false;
    while (Date.now() < deadline) {
      await sleep(1000);
      const generating = await page.locator(STOP_BUTTON).count();
      if (!generating && (await newCopy.count()) > 0) { sawNewReply = true; break; }
      if (!generating) {
        const body = await page.innerText("body").catch(() => "");
        if (LIMIT_RE.test(body.slice(-3000))) throw new ChatGptLimitError("ChatGPT limit reached — try again later (or log in).");
        if (CHAT_ERROR_RE.test(body.slice(-3000))) throw new ChatGptChatError("ChatGPT chat error");
      }
    }
    if (!sawNewReply) throw new ChatGptChatError("No reply from ChatGPT in time");
    await sleep(800); // let the last tokens render

    // Click "Copy response" through the DOM: ChatGPT sometimes lays a panel over it, which blocks a mouse click.
    const before = (await page.evaluate("window.__jhGpt.length")) as number;
    const copyBtn = newCopy.last();
    await copyBtn.evaluate((b) => (b as HTMLElement).click());
    await sleep(600);
    const copied = (await page.evaluate("window.__jhGpt")) as string[];
    if (copied.length > before) return copied[copied.length - 1];

    // Fallback: read the reply's text from the page (the turn that holds that button).
    const text = await copyBtn.evaluate((b) => {
      let el: HTMLElement | null = b as HTMLElement;
      while (el && !el.querySelector("pre, p")) el = el.parentElement;
      return el ? el.innerText : "";
    });
    if (text.includes("{")) return text;
    throw new ChatGptChatError("Could not read ChatGPT's reply");
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
  }
}

/** Pulls the first JSON object out of a reply (handles ```json fences and text around it). */
export function extractJson<T = unknown>(reply: string): T {
  const start = reply.indexOf("{");
  if (start < 0) throw new Error("No JSON in reply");
  let depth = 0;
  let inString = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(reply.slice(start, i + 1)) as T;
  }
  throw new Error("Unterminated JSON in reply");
}
