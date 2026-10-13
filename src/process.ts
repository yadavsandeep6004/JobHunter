// npm run process
// Takes the posts you sent with the 📩 button that have an email (Status NEW in the sheet),
// asks ChatGPT (in the project's Chrome) for {fit?, cv, to_email, subject, message} and hands the
// answer back to the sheet, which creates the Gmail draft with the matching CV.
// Nothing is stored locally; posts that fail stay NEW and are retried next run.
import type { BrowserContext } from "playwright";
import { loadConfig } from "./config.ts";
import { openBrowser, randomDelay } from "./browser.ts";
import { ChatGpt, ChatGptLimitError } from "./chatgpt/client.ts";
import { buildPrompt, loadProfile, parseReply } from "./chatgpt/prompt.ts";
import { pendingPosts, sendResult, sheetConfigured } from "./sheet.ts";

export interface ProcessStats {
  drafted: number;
  notFit: number;
  other: number;
  failed: number;
  left: number;
}

export async function processPending(context: BrowserContext): Promise<ProcessStats> {
  const cfg = loadConfig();
  const profile = loadProfile(); // fail early if it's missing
  const stats: ProcessStats = { drafted: 0, notFit: 0, other: 0, failed: 0, left: 0 };
  const posts = await pendingPosts();
  if (posts.length === 0) {
    console.log("Nothing new — click 📩 Send on some LinkedIn posts first.");
    return stats;
  }
  console.log(`ChatGPT: writing emails for ${posts.length} post(s)...`);

  const gpt = new ChatGpt(context, {
    maxTurnsPerChat: cfg.chatgpt.maxPostsPerChat,
    replyTimeoutMs: cfg.chatgpt.replyTimeoutSec * 1000,
  });
  await gpt.open();
  try {
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      try {
        const ai = parseReply(await gpt.ask(buildPrompt(p, profile)), p.emails);
        const status = await sendResult(p.postId, ai);
        if (status === "DRAFTED") { stats.drafted++; console.log(`   ✉ ${p.author} → ${ai.toEmail} [${ai.cv}] ${ai.role} · draft created`); }
        else if (status === "SKIPPED") { stats.notFit++; console.log(`   – ${p.author}: not a fit (${ai.reason})`); }
        else { stats.other++; console.log(`   • ${p.author}: ${status}`); }
      } catch (err) {
        if (err instanceof ChatGptLimitError) {
          stats.left = posts.length - i;
          console.warn(`   ✗ ${err.message} ${stats.left} post(s) left for the next run.`);
          break;
        }
        stats.failed++;
        console.warn(`   ✗ ${p.author}: ${(err as Error).message.split("\n")[0]} (stays NEW, retried next run)`);
      }
      await randomDelay(cfg.chatgpt.delayMs);
    }
  } finally {
    await gpt.close();
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!sheetConfigured()) {
    console.error("✗ Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see docs/start.md).");
    process.exit(1);
  }
  const session = await openBrowser({ headless: loadConfig().headless });
  try {
    const s = await processPending(session.context);
    console.log(`\nDrafts created: ${s.drafted} · not a fit: ${s.notFit}` +
      (s.other ? ` · duplicate/other: ${s.other}` : "") + (s.failed ? ` · failed: ${s.failed}` : "") +
      (s.left ? ` · waiting for ChatGPT limit: ${s.left}` : ""));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}
