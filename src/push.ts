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
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.SYNC_TOKEN;
  if (!url || !token) throw new Error("Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see apps-script/SETUP.md).");

  const payload = JSON.stringify({ token, rows });
  let lastError = "";
  // Google's web-app endpoint sometimes answers with an HTML error page even when the script ran;
  // the sheet de-dupes by post ID, so retrying is safe.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    const text = await res.text();
    let body: { ok?: boolean; added?: number; skipped?: number; drafted?: number; error?: string };
    try {
      body = JSON.parse(text);
    } catch {
      lastError = `Apps Script did not return JSON (HTTP ${res.status}). Is the web app deployed with access "Anyone"?`;
      await new Promise((r) => setTimeout(r, attempt * 3000));
      continue;
    }
    if (!body.ok) throw new Error(`Apps Script error: ${body.error ?? "unknown"}`);
    return { added: body.added ?? 0, skipped: body.skipped ?? 0, drafted: body.drafted ?? 0 };
  }
  throw new Error(`${lastError} (tried 4 times)`);
}
