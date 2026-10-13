// Turns a clicked post into a sheet row (emails, form links, post time) and sends it to the
// Google Sheet's Apps Script web app. Settings (URL + token) come from the options page.
import { toRow } from "./lib/row.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // answer asynchronously
});

// clicking the toolbar icon opens the settings
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function handle(msg) {
  const { url, token } = await chrome.storage.local.get(["url", "token"]);
  if (!url || !token) {
    chrome.runtime.openOptionsPage();
    return { ok: false, error: "Set the sheet URL and token in the extension settings first." };
  }
  if (msg.type === "ping") return callSheet(url, { token, action: "ping" });
  if (msg.type === "capture") {
    const res = await callSheet(url, { token, action: "capture", rows: [toRow(msg.post)] });
    return { ok: res.ok, error: res.error, added: res.added, status: res.status };
  }
  return { ok: false, error: `Unknown message ${msg.type}` };
}

async function callSheet(url, body) {
  // Google's endpoint occasionally answers with an HTML error page; the sheet de-dupes, so one retry is safe.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (attempt === 2) return { ok: false, error: `The sheet didn't answer properly (HTTP ${res.status}). Check the URL / deployment.` };
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
