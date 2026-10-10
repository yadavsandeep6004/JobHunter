// Transport to the Google Sheet's Apps Script web app (see apps-script/SETUP.md).
// Needs APPS_SCRIPT_URL and SYNC_TOKEN in .env.
import type { AiReply } from "./chatgpt/prompt.ts";

export interface SheetRow {
  postId: string;
  postedAt: string | null;
  author: string | null;
  headline: string | null;
  profileUrl: string | null;
  emails: string;
  formLinks: string;
  postUrl: string;
  score: number;
  skills: string;
  experience: string | null;
  content: string;
  /** ChatGPT's decision + email; absent for posts without an email address. */
  ai?: AiReply;
}

export interface PushResult {
  added: number;
  skipped: number;
  drafted: number;
}

export function pushConfigured(): boolean {
  return !!(process.env.APPS_SCRIPT_URL && process.env.SYNC_TOKEN);
}

export async function pushRows(rows: SheetRow[]): Promise<PushResult> {
  const body = await callSheet({ rows });
  return { added: (body.added as number) ?? 0, skipped: (body.skipped as number) ?? 0, drafted: (body.drafted as number) ?? 0 };
}

/** Post IDs already in the sheet. Throws if the deployed Apps Script is an old version (it would drop ChatGPT's emails). */
export async function sheetPostIds(): Promise<Set<string>> {
  const body = await callSheet({ action: "ids" });
  if (!Array.isArray(body.ids)) {
    throw new Error("The sheet's Apps Script deployment is an old version. Paste the new apps-script/Code.gs, then " +
      "Deploy → Manage deployments → ✏️ → Version: New version → Deploy, and run this again.");
  }
  return new Set(body.ids as string[]);
}

async function callSheet(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.SYNC_TOKEN;
  if (!url || !token) throw new Error("Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see apps-script/SETUP.md).");

  const payload = JSON.stringify({ token, ...data });
  let lastError = "";
  // Google's web-app endpoint sometimes answers with an HTML error page even when the script ran;
  // the sheet de-dupes by post ID, so retrying is safe.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      lastError = `Apps Script did not return JSON (HTTP ${res.status}). Is the web app deployed with access "Anyone"?`;
      await new Promise((r) => setTimeout(r, attempt * 3000));
      continue;
    }
    if (!body.ok) throw new Error(`Apps Script error: ${body.error ?? "unknown"}`);
    return body;
  }
  throw new Error(`${lastError} (tried 4 times)`);
}
