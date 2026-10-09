# Google Sheet + Email setup (ChatGPT flow)

Sheet: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit

```
npm run collect
 ├─ Chrome tab 1: LinkedIn  → matching hiring posts
 ├─ Chrome tab 2: ChatGPT   → for each post with an email: JSON {cv, to_email, subject, message}
 │                            (new chat every 8 posts — config/search.json → chatgpt.maxPostsPerChat)
 └─ POST to the sheet       → row in "Jobs" + Gmail draft with the matching CV attached
You: check Gmail → Drafts → tick "Approve" → ⚡ Auto Apply → Send approved drafts
```

No Gemini / API key needed — ChatGPT runs in the browser with your own account.

## Update the script (when Code.gs changes)
1. Sheet → **Extensions → Apps Script** → replace all of `Code.gs` with [`Code.gs`](Code.gs) → **Save**.
2. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**.
   The URL stays the same, so `.env` doesn't change. (Without this step the Mac still talks to the old code.)
3. Run **⚡ Auto Apply → ⚙️ Setup** once — it asks for the 3 CV Drive links (leave empty to keep) and
   re-authorises Gmail/Drive if needed.

## First-time setup
1. Upload `cv/frontend.pdf`, `cv/backend.pdf`, `cv/fullstack.pdf` to Google Drive.
2. Paste `Code.gs` as above, reload the sheet, run **⚡ Auto Apply → ⚙️ Setup**, allow access
   (**Advanced → Go to … (unsafe) → Allow** — it's your own script).
3. **Deploy → New deployment → ⚙️ Web app** · Execute as **Me** · Who has access **Anyone** → copy the URL.
4. On the Mac: `cp .env.example .env` and fill `APPS_SCRIPT_URL` + `SYNC_TOKEN` (shown by Setup).
5. `npm run login` — log in to LinkedIn (tab 1) and ChatGPT (tab 2), then Cmd+Q.

## Daily use

| Where | What |
|---|---|
| Mac | `npm run collect` — LinkedIn → ChatGPT → sheet + Gmail drafts, all in one go |
| Mac | `npm run process` — only the ChatGPT → sheet part (e.g. after a ChatGPT limit) |
| Gmail | Drafts → read / edit |
| Sheet | tick **Approve** (or **Approve all drafted**) → **⚡ Auto Apply → Send approved drafts** (max 40/day) |

### Status column

| Status | Meaning |
|---|---|
| DRAFTED | ChatGPT wrote it, Gmail draft with the right CV is ready — waiting for Approve |
| SENT | sent — date in **Sent At** |
| SKIPPED | ChatGPT says it's not a fit (reason in Notes) |
| DUPLICATE | that address was already emailed |
| READY | email written but the draft failed → **Create missing drafts** |
| FORM | apply via the Google Form link |
| NO_EMAIL | no email in the post — open Post URL and DM the author |
| PENDING | old rows from the Gemini version (see below) |
| ERROR | send failed, see Notes |

### Redo the old PENDING rows with ChatGPT
Delete those rows in the sheet, then on the Mac: `npm run process -- --resend`
(rows still in the sheet are skipped automatically).
