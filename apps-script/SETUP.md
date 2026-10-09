# Google Sheet + Email setup (one time, ~10 min)

Sheet: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit

## 1. Upload your 3 CVs to Google Drive
Upload `cv/frontend.pdf`, `cv/backend.pdf`, `cv/fullstack.pdf` from this project to Google Drive.
Keep them private — the script reads them as you.

## 2. Paste the script
1. Open the sheet → **Extensions → Apps Script**.
2. Delete everything in `Code.gs`, paste the whole of [`Code.gs`](Code.gs) from this folder, press **Save** (💾).

## 3. Run Setup
1. Reload the sheet. A **⚡ Auto Apply** menu appears.
2. **⚡ Auto Apply → ⚙️ Setup**.
3. Google asks for permission → choose your account → **Advanced → Go to … (unsafe)** → **Allow**.
   (It says "unsafe" only because it's your own unpublished script.)
4. Paste when asked:
   - your **new** Gemini API key (https://aistudio.google.com/apikey) — rotate the old one, it was shared in chat
   - the Drive links of your Frontend, Backend and Full Stack CVs
5. The last dialog shows a `SYNC_TOKEN=…` line — copy it.

This creates a **Jobs** tab. Your old `Daily_Queue` / `Applications_Tracker` tabs are not used any more.

## 4. Deploy the receiver (so your Mac can add rows)
1. In Apps Script: **Deploy → New deployment** → ⚙️ **Web app**.
2. Execute as: **Me** · Who has access: **Anyone** → **Deploy**.
3. Copy the **Web app URL** (ends in `/exec`).

"Anyone" only means the URL is reachable; every request must carry your secret `SYNC_TOKEN` or it's rejected.

> If you change `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same).

## 5. Connect the Mac
In the project folder:

```bash
cp .env.example .env
```

Open `.env` and fill in both lines:

```
APPS_SCRIPT_URL=https://script.google.com/macros/s/…/exec
SYNC_TOKEN=…the token from step 3…
```

Test it:

```bash
npm run push
```

Rows appear in the **Jobs** tab.

---

## Daily use

| Where | What |
|---|---|
| Mac | `npm run collect` — collects posts **and** pushes them to the sheet automatically |
| Sheet | **⚡ Auto Apply → 1. Write emails** — Gemini picks the Frontend / Backend / Full Stack CV, writes the email, creates a Gmail **draft** with that CV attached (20 per run; run again for more) |
| Gmail | Open **Drafts**, read / edit them |
| Sheet | Tick **Approve** for the good ones (or **Approve all drafted**) |
| Sheet | **⚡ Auto Apply → 2. Send approved drafts** — sends them, fills **Sent At** (max 40/day) |

### Status column

| Status | Meaning |
|---|---|
| PENDING | has an email, waiting for "Write emails" |
| DRAFTED | Gmail draft ready, waiting for your Approve |
| SENT | sent — date in **Sent At** |
| SKIPPED | Gemini decided it's not a fit (reason in Notes) |
| DUPLICATE | you already emailed that address |
| FORM | apply via the Google Form link (manual for now) |
| NO_EMAIL | no email in the post — open Post URL and DM the author |
| ERROR | see Notes; set Status back to PENDING to retry |

Edits you make in the Gmail draft are what gets sent (the sheet's Subject/Body columns are just a record).
