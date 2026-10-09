import type { Page } from "playwright";
import { sleep } from "../browser.ts";

export interface RawPost {
  /** Our own marker on the post element, used to click its menu later. */
  domId: string;
  /** Post URN when the page exposes it (group posts, legacy layout); otherwise resolved later. */
  urn: string | null;
  author: string;
  headline: string;
  profileUrl: string;
  timeLabel: string;
  text: string;
  links: { href: string; text: string }[];
}

export type DatePosted = "past-24h" | "past-week" | "past-month";

export function searchUrl(query: string, datePosted: DatePosted): string {
  const params = new URLSearchParams({
    keywords: query,
    origin: "FACETED_SEARCH",
    sortBy: '["date_posted"]',
    datePosted: `["${datePosted}"]`,
  });
  return `https://www.linkedin.com/search/results/content/?${params.toString()}`;
}

// LinkedIn serves more than one layout. The stable hook across them is each post's
// menu button: aria-label="Open control menu for post by <author>".
const MENU_BUTTON = 'button[aria-label^="Open control menu for post"]';
const POST_SELECTOR = `[role="listitem"]:has(${MENU_BUTTON}), [data-urn^="urn:li:activity:"]`;

// In-page scripts are plain strings so the TS loader can't inject helpers
// that don't exist in the browser.

const EXTRACT_POSTS = `(() => {
  window.__jhSeq = window.__jhSeq || 0;
  const URN_RE = /urn(?::|%3A)li(?::|%3A)(activity|ugcPost|share)(?::|%3A)(\\d{15,})/;
  const TIME_RE = /^(\\d+)\\s?(s|m|h|d|w|mo|yr|y)\\b/;
  const out = [];
  for (const post of document.querySelectorAll('${POST_SELECTOR}')) {
    if (post.parentElement && post.parentElement.closest('${POST_SELECTOR}')) continue; // nested (reshare)
    if (!post.dataset.jhId) post.dataset.jhId = String(++window.__jhSeq);

    // URN: legacy layout has data-urn; new layout only exposes it on group posts.
    let urn = null;
    const attrUrn = (post.getAttribute("data-urn") || "").match(URN_RE);
    const hrefUrn = Array.from(post.querySelectorAll("a[href*='activity'], a[href*='ugcPost']"))
      .map((a) => decodeURIComponent(a.getAttribute("href") || "").match(URN_RE)).find(Boolean);
    const m = attrUrn || hrefUrn;
    if (m) urn = "urn:li:" + m[1] + ":" + m[2];

    const menu = post.querySelector('${MENU_BUTTON}');
    const menuAuthor = menu ? (menu.getAttribute("aria-label") || "").replace(/^Open control menu for post by\\s*/i, "").trim() : "";
    const actor = post.querySelector('[data-view-name="feed-actor"], .update-components-actor__meta-link, a[href*="/in/"], a[href*="/company/"]');
    const author = menuAuthor || (actor ? actor.innerText.split("\\n")[0].trim() : "");
    const profileUrl = actor && actor.href ? actor.href.split("?")[0] : "";

    // Header lines: author, "• 3rd+", headline, "27m •", "Follow", ...
    const lines = (post.innerText || "").split("\\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => TIME_RE.test(l));
    const timeLabel = timeIdx >= 0 ? lines[timeIdx] : "";
    const authorIdx = lines.indexOf(author);
    const headline = authorIdx >= 0 && timeIdx > authorIdx
      ? (lines.slice(authorIdx + 1, timeIdx).find((l) => !/^•/.test(l) && l !== author) || "")
      : "";

    const bodies = Array.from(post.querySelectorAll('[data-testid="expandable-text-box"], [data-view-name="feed-commentary"], .update-components-text'))
      .map((n) => (n.innerText || "").trim());
    let text = bodies.sort((a, b) => b.length - a.length)[0] || "";
    text = text.replace(/\\n?…\\s*more$/, "").trim();

    const links = Array.from(post.querySelectorAll("a[href]"))
      .map((a) => ({ href: a.href, text: (a.innerText || "").trim() }))
      .filter((l) => l.href && !l.href.startsWith("javascript"));

    out.push({ domId: post.dataset.jhId, urn, author, headline, profileUrl, timeLabel, text, links });
  }
  return out;
})()`;

const EXPAND_SEE_MORE = `(() => {
  let n = 0;
  for (const post of document.querySelectorAll('${POST_SELECTOR}')) {
    for (const b of post.querySelectorAll("button")) {
      const t = (b.innerText || "").trim();
      const isMore = b.getAttribute("data-testid") === "expandable-text-button" || /^(…|\\.\\.\\.)\\s*(see )?more$/i.test(t);
      if (isMore && /more/i.test(t) && b.getAttribute("aria-expanded") !== "true") {
        try { b.click(); n++; } catch (e) {}
      }
    }
  }
  return n;
})()`;

const LOAD_MORE = `(() => {
  const posts = document.querySelectorAll('${POST_SELECTOR}');
  const last = posts[posts.length - 1];
  // the wrapper has no box of its own (display:contents) — scroll its list item instead
  const target = last && (last.closest('[role="listitem"]') || last.firstElementChild);
  if (target) target.scrollIntoView({ block: "end" });
  window.scrollBy(0, Math.round(window.innerHeight * 0.6));
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    /^(show more results|load more|see more results)$/i.test((b.innerText || "").trim()));
  if (btn && btn.offsetParent !== null) { btn.click(); return true; }
  return false;
})()`;

// "Copy link to post" writes to the clipboard; capture it instead of touching the real clipboard.
const HOOK_CLIPBOARD = `(() => {
  if (window.__jhHooked) return;
  window.__jhHooked = true;
  window.__jhCopied = [];
  if (navigator.clipboard) {
    navigator.clipboard.writeText = (t) => { window.__jhCopied.push(String(t)); return Promise.resolve(); };
  }
})()`;

/** Waits for search results. Returns false if the page shows no posts. */
export async function waitForResults(page: Page): Promise<boolean> {
  try {
    // state "attached": the post wrapper is display:contents, so it never counts as visible
    await page.waitForSelector(POST_SELECTOR, { state: "attached", timeout: 15_000 });
    await page.evaluate(HOOK_CLIPBOARD);
    return true;
  } catch {
    return false;
  }
}

export async function extractPosts(page: Page): Promise<RawPost[]> {
  const expanded = (await page.evaluate(EXPAND_SEE_MORE).catch(() => 0)) as number;
  if (expanded > 0) await sleep(600);
  return (await page.evaluate(EXTRACT_POSTS)) as RawPost[];
}

export async function loadMore(page: Page): Promise<void> {
  await page.evaluate(LOAD_MORE).catch(() => false);
}

/** Uses the post's "Copy link to post" menu item; returns the lnkd.in short link. */
export async function copyPostLink(page: Page, domId: string): Promise<string | null> {
  const menuBtn = page.locator(`[data-jh-id="${domId}"] ${MENU_BUTTON}`).first();
  const copyItem = page.getByText("Copy link to post", { exact: true }).first();
  try {
    await page.evaluate(HOOK_CLIPBOARD);
    const before = (await page.evaluate("window.__jhCopied.length")) as number;
    // Posts are wired up lazily once they scroll into view — a click before that is ignored.
    await menuBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
    await sleep(1200 + Math.random() * 600);
    for (let attempt = 0; attempt < 2; attempt++) {
      await menuBtn.click({ timeout: 5000 });
      const opened = await copyItem.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false);
      if (opened) break;
      await page.keyboard.press("Escape");
      await sleep(1200);
    }
    await copyItem.click({ timeout: 2000 });
    await sleep(400);
    await page.keyboard.press("Escape");
    const copied = (await page.evaluate("window.__jhCopied")) as string[];
    return copied.length > before ? copied[copied.length - 1] : null;
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    return null;
  }
}

/** Follows a lnkd.in short link's redirect (no LinkedIn session involved) to read the post URN. */
export async function resolvePostUrn(shortLink: string): Promise<string | null> {
  try {
    const res = await fetch(shortLink, { method: "HEAD", redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" } });
    const loc = decodeURIComponent(res.headers.get("location") ?? "");
    const m =
      loc.match(/urn:li:(activity|ugcPost):(\d{15,})/) ??
      loc.match(/-(activity|ugcPost)-(\d{15,})/);
    return m ? `urn:li:${m[1]}:${m[2]}` : null;
  } catch {
    return null;
  }
}
