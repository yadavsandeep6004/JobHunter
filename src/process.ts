// For every collected post not yet in the Google Sheet:
//   has an email → ask ChatGPT (2nd browser tab) for {cv, to_email, subject, message} → send to the sheet,
//                  where the Apps Script creates the Gmail draft with the matching CV attached
//   no email     → send to the sheet as FORM / NO_EMAIL (no ChatGPT needed)
// ChatGPT's answer is not stored locally — it goes straight to the sheet. The DB only remembers
// which posts were sent (pushed_at), so nothing is sent twice.
//
//   npm run process   -> run on its own (opens Chrome)
//   npm run collect   -> calls this automatically after collecting
import type { BrowserContext } from "playwright";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { openBrowser, randomDelay } from "./browser.ts";
import { ChatGpt, ChatGptLimitError } from "./chatgpt/client.ts";
import { buildPrompt, parseReply } from "./chatgpt/prompt.ts";
import { pushConfigured, pushRows, sheetPostIds, type SheetRow } from "./push.ts";

interface Row {
  id: number;
  post_urn: string;
  posted_at: string | null;
  author_name: string | null;
  author_headline: string | null;
  author_profile_url: string | null;
  emails: string;
  form_links: string;
  post_url: string;
  match_score: number;
  matched_skills: string;
  experience_text: string | null;
  content: string;
}

export interface ProcessStats {
  sent: number;
  drafted: number;
  skippedByAi: number;
  failed: number;
  left: number;
}

function toSheetRow(r: Row): SheetRow {
  return {
    postId: r.post_urn,
    postedAt: r.posted_at,
    author: r.author_name,
    headline: r.author_headline,
    profileUrl: r.author_profile_url,
    emails: r.emails,
    formLinks: r.form_links,
    postUrl: r.post_url,
    score: r.match_score,
    skills: r.matched_skills,
    experience: r.experience_text,
    content: r.content,
  };
}

export async function processPending(context: BrowserContext): Promise<ProcessStats> {
  if (!pushConfigured()) throw new Error("Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see apps-script/SETUP.md).");
  const cfg = loadConfig();
  const db = openDb();
  let rows = db
    .prepare(`SELECT id, post_urn, posted_at, author_name, author_headline, author_profile_url, emails, form_links,
                     post_url, match_score, matched_skills, experience_text, content
              FROM posts WHERE status = 'new' AND pushed_at IS NULL ORDER BY posted_at`)
    .all() as unknown as Row[];
  const markSent = db.prepare(`UPDATE posts SET pushed_at = ? WHERE id = ?`);
  const stats: ProcessStats = { sent: 0, drafted: 0, skippedByAi: 0, failed: 0, left: 0 };
  if (rows.length === 0) return stats;

  // Skip posts the sheet already has — no point spending ChatGPT messages on them.
  // (Also checks the deployed sheet script is current before any ChatGPT work.)
  const inSheet = await sheetPostIds();
  {
    const now = new Date().toISOString();
    for (const r of rows) if (inSheet.has(r.post_urn)) markSent.run(now, r.id);
    const before = rows.length;
    rows = rows.filter((r) => !inSheet.has(r.post_urn));
    if (before !== rows.length) console.log(`${before - rows.length} post(s) already in the sheet — skipped.`);
    if (rows.length === 0) return stats;
  }

  // Posts without an email don't need ChatGPT — send them in one go.
  const noEmail = rows.filter((r) => !r.emails);
  if (noEmail.length) {
    await pushRows(noEmail.map(toSheetRow));
    const now = new Date().toISOString();
    for (const r of noEmail) markSent.run(now, r.id);
    stats.sent += noEmail.length;
  }

  const withEmail = rows.filter((r) => r.emails);
  if (withEmail.length === 0) return stats;
  console.log(`\nChatGPT: writing emails for ${withEmail.length} post(s)...`);

  const gpt = new ChatGpt(context, {
    maxTurnsPerChat: cfg.chatgpt.maxPostsPerChat,
    replyTimeoutMs: cfg.chatgpt.replyTimeoutSec * 1000,
  });
  await gpt.open();
  try {
    for (let i = 0; i < withEmail.length; i++) {
      const r = withEmail[i];
      const emails = r.emails.split(",").filter(Boolean);
      let row: SheetRow;
      try {
        const reply = await gpt.ask(buildPrompt({ author: r.author_name, headline: r.author_headline, emails, content: r.content }));
        row = { ...toSheetRow(r), ai: parseReply(reply, emails) };
      } catch (err) {
        if (err instanceof ChatGptLimitError) {
          stats.left = withEmail.length - i;
          console.warn(`   ✗ ${err.message} ${stats.left} post(s) left for the next run.`);
          break;
        }
        stats.failed++;
        console.warn(`   ✗ ${r.author_name ?? "?"}: ${(err as Error).message.split("\n")[0]} (will retry next run)`);
        continue;
      }

      const res = await pushRows([row]);
      markSent.run(new Date().toISOString(), r.id);
      stats.sent++;
      stats.drafted += res.drafted;
      const ai = row.ai!;
      if (ai.relevant) console.log(`   ✉ ${r.author_name ?? "?"} → ${ai.toEmail} [${ai.cv}] ${ai.role || ""}${res.drafted ? " · draft created" : ""}`);
      else { stats.skippedByAi++; console.log(`   – ${r.author_name ?? "?"}: not a fit (${ai.reason})`); }
      await randomDelay(cfg.chatgpt.delayMs);
    }
  } finally {
    await gpt.close();
  }
  return stats;
}

export function printStats(s: ProcessStats): void {
  console.log(`Sheet: ${s.sent} post(s) sent, ${s.drafted} Gmail draft(s) created, ${s.skippedByAi} not a fit` +
    (s.failed ? `, ${s.failed} failed (retry next run)` : "") + (s.left ? `, ${s.left} waiting for ChatGPT limit` : ""));
}

// Run directly: npm run process
//   --resend : forget what was sent before and send every post again (the sheet still skips Post IDs it has —
//              delete those rows in the sheet first if you want them redone with ChatGPT)
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--resend")) {
    const n = openDb().prepare(`UPDATE posts SET pushed_at = NULL WHERE status = 'new'`).run().changes;
    console.log(`Marked ${n} post(s) to be sent again.`);
  }
  const cfg = loadConfig();
  const session = await openBrowser({ headless: cfg.headless });
  try {
    printStats(await processPending(session.context));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}
