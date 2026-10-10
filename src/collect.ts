// Daily run (npm run collect):
//   1. LinkedIn tab: hiring posts published since the last successful run that match config/search.json
//   2. ChatGPT tab + Google Sheet: see process.ts
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { DEBUG_DIR, loadConfig } from "./config.ts";
import { finishRun, insertPost, isKnownPost, lastSuccessfulRun, openDb, startRun } from "./db.ts";
import { firstPage, isChallengeUrl, isLoggedOutUrl, openBrowser, randomDelay } from "./browser.ts";
import {
  copyPostLink, extractPosts, loadMore, resolvePostUrn, searchUrl, waitForResults,
  type DatePosted, type RawPost,
} from "./linkedin/searchPosts.ts";
import { cleanText, extractEmails, extractFormLinks, timeFromRelative, timeFromUrn } from "./extract.ts";
import { matchPost } from "./match.ts";
import { pushConfigured } from "./push.ts";
import { printStats, processPending } from "./process.ts";

// Re-scan a little before the last run started so nothing posted mid-run is missed.
// Duplicates are ignored by the DB, so the overlap is safe.
const OVERLAP_MS = 15 * 60_000;
const MAX_IDLE_SCROLLS = 3;

const cfg = loadConfig();
const db = openDb();

const startedAt = new Date();
const last = lastSuccessfulRun(db);
const since = last
  ? new Date(new Date(last.started_at).getTime() - OVERLAP_MS)
  : new Date(startedAt.getTime() - cfg.firstRunLookbackHours * 3_600_000);

const windowHours = (startedAt.getTime() - since.getTime()) / 3_600_000;
const datePosted: DatePosted = windowHours <= 24 ? "past-24h" : windowHours <= 24 * 7 ? "past-week" : "past-month";

const runId = startRun(db, startedAt, since);
console.log(`Run #${runId}: collecting posts since ${since.toLocaleString()} (${windowHours.toFixed(1)}h, filter ${datePosted})`);
if (!last) console.log(`(first run — looking back ${cfg.firstRunLookbackHours}h)`);

const stats = { scanned: 0, matched: 0, inserted: 0 };
const seen = new Set<string>();
let queriesWithPosts = 0;

class StopRun extends Error {}

const SEARCH_PAUSED_RE = /unusual search traffic|search activity on your account has been paused/i;

async function saveDebug(page: Page, label: string): Promise<string> {
  mkdirSync(DEBUG_DIR, { recursive: true });
  const base = path.join(DEBUG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
  await page.screenshot({ path: `${base}.png` }).catch(() => {});
  await page.content().then((html) => writeFileSync(`${base}.html`, html)).catch(() => {});
  return base;
}

function contentHash(raw: RawPost): string {
  const norm = `${raw.profileUrl || raw.author}|${raw.text}`.toLowerCase().replace(/\s+/g, " ").slice(0, 600);
  return createHash("sha1").update(norm).digest("hex");
}

async function handlePost(page: Page, raw: RawPost, query: string): Promise<"old" | "kept" | "skipped"> {
  // Rough age first (exact time needs the URN, which costs clicks) — skip clearly old posts.
  const rough = raw.urn ? timeFromUrn(raw.urn) : timeFromRelative(raw.timeLabel);
  if (rough && rough < since) return "old";
  if (!raw.text) return "skipped";
  raw.text = cleanText(raw.text);

  const hash = contentHash(raw);
  if (isKnownPost(db, hash, raw.urn)) return "skipped";

  const linkTexts = raw.links.map((l) => l.text).join("\n");
  const mailtos = raw.links.filter((l) => l.href.startsWith("mailto:")).map((l) => l.href.slice(7).split("?")[0].toLowerCase());
  const emails = [...new Set([...extractEmails(raw.text), ...extractEmails(linkTexts), ...mailtos])];
  const formLinks = extractFormLinks(raw.text, linkTexts, ...raw.links.map((l) => l.href));

  const m = matchPost(raw.text, cfg, { emails, formLinks }, `${raw.author}\n${raw.headline}`);
  if (!m.ok) return "skipped";

  // Matched: get the real post link + exact time.
  let urn = raw.urn;
  let shortLink: string | null = null;
  if (!urn) {
    shortLink = await copyPostLink(page, raw.domId);
    if (shortLink) urn = await resolvePostUrn(shortLink);
  }
  const exact = urn ? timeFromUrn(urn) : null;
  if (exact && exact < since) return "old";
  const postedAt = exact ?? rough;
  stats.matched++;

  const inserted = insertPost(db, runId, {
    post_urn: urn ?? `hash:${hash}`,
    content_hash: hash,
    post_url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : shortLink ?? raw.profileUrl,
    author_name: raw.author || null,
    author_headline: raw.headline || null,
    author_profile_url: raw.profileUrl || null,
    content: raw.text,
    emails,
    form_links: formLinks,
    matched_skills: m.matchedSkills,
    match_score: m.score,
    experience_text: m.experienceText,
    query,
    posted_at: postedAt ? postedAt.toISOString() : null,
    posted_at_source: exact ? "id" : postedAt ? "relative" : null,
  });
  if (inserted) {
    stats.inserted++;
    const contact = emails.length ? emails.join(", ") : formLinks.length ? "Google Form" : "no contact";
    console.log(`   + ${raw.author || "(unknown)"} — ${contact} [score ${m.score}]`);
  }
  return "kept";
}

async function runQuery(page: Page, query: string) {
  console.log(`\n» "${query}"`);
  await page.goto(searchUrl(query, datePosted), { waitUntil: "domcontentloaded" });

  const url = page.url();
  if (isLoggedOutUrl(url)) throw new StopRun("Not logged in to LinkedIn. Run `npm run login` first.");
  if (isChallengeUrl(url)) {
    await saveDebug(page, "challenge");
    throw new StopRun("LinkedIn is asking for a security check. Run `npm run login`, complete it, and try again later.");
  }

  if (!(await waitForResults(page))) {
    const body = await page.innerText("body").catch(() => "");
    if (SEARCH_PAUSED_RE.test(body)) {
      await saveDebug(page, "search-paused");
      throw new StopRun("LinkedIn paused search for this account (\"unusual search traffic\"). " +
        "Stop running collect for at least 24 hours, then run it at most once a day.");
    }
    const noResults = /no results found/i.test(body);
    if (noResults) {
      queriesWithPosts++; // page worked, just nothing new
      console.log("   no results");
    } else {
      console.log(`   no posts found on page (saved ${await saveDebug(page, "no-posts")}.png / .html)`);
    }
    return;
  }
  queriesWithPosts++;
  await randomDelay({ min: 1000, max: 2000 });

  let scannedHere = 0;
  let oldStreak = 0;
  let idle = 0;

  while (scannedHere < cfg.maxPostsPerQuery) {
    const posts = await extractPosts(page);
    let fresh = 0;
    for (const raw of posts) {
      if (seen.has(raw.domId)) continue;
      seen.add(raw.domId);
      fresh++;
      scannedHere++;
      stats.scanned++;
      const r = await handlePost(page, raw, query);
      oldStreak = r === "old" ? oldStreak + 1 : 0;
      if (oldStreak >= cfg.stopAfterOldPosts) {
        console.log(`   reached posts older than the window`);
        return;
      }
    }
    idle = fresh === 0 ? idle + 1 : 0;
    if (idle >= MAX_IDLE_SCROLLS) return;

    await loadMore(page);
    await randomDelay(cfg.delayMs);
  }
}

let status: "success" | "failed" = "success";
let error: string | undefined;
let session: Awaited<ReturnType<typeof openBrowser>> | undefined;
try {
  session = await openBrowser({ headless: cfg.headless });
  const page = await firstPage(session.context);
  try {
    for (const q of cfg.queries) {
      seen.clear(); // DOM markers restart on each page load
      try {
        await runQuery(page, q);
      } catch (err) {
        if (err instanceof StopRun) throw err;
        console.warn(`   query failed: ${(err as Error).message.split("\n")[0]}`);
      }
      await randomDelay(cfg.delayMs);
    }
    if (queriesWithPosts === 0) {
      throw new Error("No search page showed any posts — LinkedIn layout may have changed. See debug/ for screenshots.");
    }
  } catch (err) {
    status = "failed";
    error = (err as Error).message;
    console.error(`\n✗ ${error}`);
  }
  finishRun(db, runId, { status, ...stats, error });
  console.log(`\nRun #${runId} ${status}: scanned ${stats.scanned}, matched ${stats.matched}, new in DB ${stats.inserted}`);
  if (status === "failed") console.log("(a failed run doesn't move the time window — the next run covers it again)");

  // 2nd tab: ChatGPT writes the emails → rows go straight to the Google Sheet (drafts created there).
  // Runs even after a failed collect, so posts that were saved still get processed.
  if (pushConfigured()) {
    try {
      printStats(await processPending(session.context));
    } catch (err) {
      console.warn(`Sheet/ChatGPT step failed: ${(err as Error).message.split("\n")[0]} — retry with: npm run process`);
    }
  } else {
    console.log("(Google Sheet not configured — see docs/start.md)");
  }
} catch (err) {
  // the browser didn't start
  status = "failed";
  error = (err as Error).message;
  console.error(`\n✗ ${error}`);
  finishRun(db, runId, { status, ...stats, error });
} finally {
  await session?.close();
}

if (status === "failed") process.exit(1);
