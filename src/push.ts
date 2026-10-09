// Sends matched posts that aren't in the Google Sheet yet to the sheet's Apps Script web app.
// Each pushed post lands in the "Jobs" tab with Status = PENDING (or NO_EMAIL / FORM).
//   npm run push            -> push everything not yet pushed
//   npm run push -- --dry   -> show what would be pushed
// Needs APPS_SCRIPT_URL and SYNC_TOKEN in .env (see apps-script/SETUP.md).
import { openDb } from "./db.ts";

const BATCH = 40;

export interface PushResult {
  pushed: number;
  added: number;
  skipped: number;
}

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

/** Google's web-app endpoint sometimes answers with an HTML error page; the sheet de-dupes by post ID, so retrying is safe. */
async function postWithRetry(url: string, payload: string): Promise<{ ok?: boolean; added?: number; skipped?: number; error?: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      lastError = `Apps Script did not return JSON (HTTP ${res.status}). Is the web app deployed with access "Anyone"?`;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`${lastError} (tried 4 times)`);
}

export function pushConfigured(): boolean {
  return !!(process.env.APPS_SCRIPT_URL && process.env.SYNC_TOKEN);
}

export async function pushPending(opts: { dry?: boolean } = {}): Promise<PushResult> {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.SYNC_TOKEN;
  if (!opts.dry && (!url || !token)) {
    throw new Error("Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see apps-script/SETUP.md).");
  }

  const db = openDb();
  const rows = db
    .prepare(`SELECT id, post_urn, posted_at, author_name, author_headline, author_profile_url, emails, form_links,
                     post_url, match_score, matched_skills, experience_text, content
              FROM posts WHERE status = 'new' AND pushed_at IS NULL ORDER BY posted_at`)
    .all() as unknown as Row[];

  if (opts.dry) {
    for (const r of rows) console.log(`would push #${r.id} ${r.author_name ?? "?"} — ${r.emails || "no email"}`);
    return { pushed: 0, added: 0, skipped: 0 };
  }

  const markPushed = db.prepare(`UPDATE posts SET pushed_at = ? WHERE id = ?`);
  const result: PushResult = { pushed: 0, added: 0, skipped: 0 };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const payload = JSON.stringify({
        token,
        rows: batch.map((r) => ({
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
        })),
      });
    const body = await postWithRetry(url!, payload);
    if (!body.ok) throw new Error(`Apps Script error: ${body.error ?? "unknown"}`);

    const now = new Date().toISOString();
    for (const r of batch) markPushed.run(now, r.id);
    result.pushed += batch.length;
    result.added += body.added ?? 0;
    result.skipped += body.skipped ?? 0;
  }
  return result;
}

// Run directly: npm run push
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = await pushPending({ dry: process.argv.includes("--dry") });
    if (!process.argv.includes("--dry")) {
      console.log(`Pushed ${r.pushed} post(s): ${r.added} new row(s) in the sheet, ${r.skipped} already there.`);
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
