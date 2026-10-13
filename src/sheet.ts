// Talks to the Google Sheet's Apps Script web app (see docs/start.md). Needs APPS_SCRIPT_URL + SYNC_TOKEN in .env.
import type { AiReply } from "./chatgpt/prompt.ts";

/** A post you sent with the 📩 button that has an email and is waiting for ChatGPT (Status NEW). */
export interface PendingPost {
  postId: string;
  author: string;
  headline: string;
  emails: string[];
  content: string;
}

export function sheetConfigured(): boolean {
  return !!(process.env.APPS_SCRIPT_URL && process.env.SYNC_TOKEN);
}

export async function pendingPosts(): Promise<PendingPost[]> {
  const body = await callSheet({ action: "pending" });
  if (!Array.isArray(body.posts)) {
    throw new Error("The sheet's Apps Script deployment is an old version. Paste apps-script/Code.gs, then " +
      "Deploy → Manage deployments → ✏️ → Version: New version → Deploy.");
  }
  return body.posts as PendingPost[];
}

/** Hands ChatGPT's answer to the sheet; returns the row's new status (DRAFTED, SKIPPED, DUPLICATE, READY). */
export async function sendResult(postId: string, ai: AiReply): Promise<string> {
  const body = await callSheet({ action: "result", postId, ai });
  return String(body.status);
}

async function callSheet(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.SYNC_TOKEN;
  if (!url || !token) throw new Error("Set APPS_SCRIPT_URL and SYNC_TOKEN in .env first (see docs/start.md).");

  const payload = JSON.stringify({ token, ...data });
  let lastError = "";
  // Google's endpoint sometimes answers with an HTML error page even when the script ran; retry.
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
