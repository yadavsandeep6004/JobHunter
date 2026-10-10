# Job Hunter — Setup & Daily Use

Finds LinkedIn hiring posts that match you, lets ChatGPT write each application email,
and puts it in your Gmail drafts with the right CV (Frontend / Backend / Full Stack) attached.

## One-time setup

1. Install **Node.js 22+** and **Google Chrome**.
2. In the project folder run `npm install`.
3. Edit `config/profile.md` — your details and the "Looking for" line (ChatGPT only uses facts from here).
4. Edit `config/search.json` — search queries, your skills, years of experience, locations.
5. Upload your 3 CV PDFs (frontend, backend, full stack) to Google Drive.
6. Create a Google Sheet → **Extensions → Apps Script** → paste `apps-script/Code.gs`.
   Set `MY_NAME` at the top → **Save**.
7. Reload the sheet → **⚡ Auto Apply → ⚙️ Setup** → allow access, paste the 3 CV Drive links.
   Copy the `SYNC_TOKEN` it shows.
8. In Apps Script: **Deploy → New deployment → ⚙️ Web app** → Execute as **Me**, access **Anyone**
   → copy the Web app URL.
9. Run `cp .env.example .env` and put the URL and token in `.env`.
10. Run `npm run login` → log in to LinkedIn (tab 1) and ChatGPT (tab 2) → quit Chrome with **Cmd+Q**.

## Every day

1. Run `npm run collect` — **once a day**; leave the Chrome window alone until it finishes.
2. Open Gmail → **Drafts** and read the new emails (edit them if you like).
3. In the sheet's **Jobs** tab, tick **Approve** on the ones to send.
4. **⚡ Auto Apply → Send approved drafts** — sends them and fills in **Sent At**.

Optional: `./scripts/install-daily.sh 9 0` runs step 1 every day at 9:00 (`--uninstall` to stop).

## Commands

| Command | What it does |
|---|---|
| `npm run login` | Log in to LinkedIn + ChatGPT in the project's own Chrome profile. |
| `npm run collect` | LinkedIn → ChatGPT → Google Sheet + Gmail drafts, all in one go. |
| `npm run process` | Only the ChatGPT → sheet part (e.g. after a ChatGPT limit). |
| `npm test` | Run the unit tests. |

## Sheet status

| Status | Meaning |
|---|---|
| DRAFTED | Gmail draft with the right CV is ready — tick Approve to send. |
| SENT | Sent; date is in **Sent At**. |
| SKIPPED | ChatGPT says it's not a fit (reason in **Notes**). |
| DUPLICATE | You already emailed that address. |
| READY | Email written but the draft failed → **⚡ Auto Apply → Create missing drafts**. |
| FORM | Apply through the Google Form link in **Form Links**. |
| NO_EMAIL | No email in the post — open **Post URL** and message the author. |
| ERROR | Sending failed; see **Notes**. |

## If something goes wrong

| Message | Fix |
|---|---|
| `Not logged in to LinkedIn` | Run `npm run login` again. |
| `LinkedIn paused search…` | Too many searches — wait 24 hours, then run once a day. |
| `ChatGPT limit reached` | Run `npm run process` later; it continues where it stopped. |
| `bad token` | `SYNC_TOKEN` in `.env` must equal Script properties → `SYNC_TOKEN` in Apps Script. |
| `deployment is an old version` | Apps Script: **Deploy → Manage deployments → ✏️ → New version → Deploy**. |
| `No search page showed any posts` | LinkedIn changed its page — check the screenshot in `debug/`. |

After editing `Code.gs`, always redeploy as a **New version** (the URL stays the same).
