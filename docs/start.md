# Job Hunter — Setup & Daily Use

You browse LinkedIn yourself and click **📩 Send** on good hiring posts. ChatGPT writes each application
email, and a Gmail draft appears with the right CV (Frontend / Backend / Full Stack) attached.
Nothing automated ever runs on LinkedIn.

## One-time setup

1. Install **Node.js 22+** and **Google Chrome**, then run `npm install` in the project folder.
2. Edit `config/profile.md` — your details and the "Looking for" line (ChatGPT only uses facts from here).
3. Upload your 3 CV PDFs (frontend, backend, full stack) to Google Drive.
4. Create a Google Sheet → **Extensions → Apps Script** → paste `apps-script/Code.gs`.
   Set `MY_NAME` at the top → **Save**.
5. Reload the sheet → **⚡ Auto Apply → ⚙️ Setup** → allow access, paste the 3 CV Drive links.
   Copy the **sync token** it shows.
6. In Apps Script: **Deploy → New deployment → ⚙️ Web app** → Execute as **Me**, access **Anyone**
   → copy the **Web app URL**.
7. Run `cp .env.example .env` and put the URL and token in `.env`.
8. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `extension` folder.
9. Click the extension's icon (pin it from the 🧩 menu) → paste the same URL and token → **Save** → **Test connection**.
10. Run `npm run login` → log in to ChatGPT → quit that Chrome window with **Cmd+Q**.

## Every day

1. Browse LinkedIn as usual (search "hiring react developer", your feed…) and click **📩 Send** on good posts.
2. Run `npm run process` — ChatGPT writes the emails, Gmail drafts appear with the right CV.
3. Open Gmail → **Drafts**, read / edit them; in the sheet tick **Approve** on the ones to send.
4. **⚡ Auto Apply → Send approved drafts** — sends them and fills in **Sent At**.

Optional: `./scripts/install-daily.sh 21 0` runs step 2 every day at 21:00 (`--uninstall` to stop).

## The 📩 button

| Button shows | Meaning |
|---|---|
| ✓ Sent · email found | Saved as **NEW** — `npm run process` will write the email. |
| ✓ Sent · form | Saved as **FORM** — apply through the form link yourself. |
| ✓ Sent · no email | Saved as **NO_EMAIL** — message the author on LinkedIn. |
| ✓ Already in sheet | You sent this post before. |
| ✗ Retry | Hover it to see why (usually settings or the deployment). |

## Sheet status

| Status | Meaning |
|---|---|
| NEW | Has an email; waiting for `npm run process`. |
| DRAFTED | Gmail draft with the right CV is ready — tick **Approve** to send. |
| SENT | Sent; date is in **Sent At**. |
| SKIPPED | ChatGPT says it's not a fit (reason in **Notes**). |
| DUPLICATE | You already emailed that address. |
| READY | Email written but the draft failed → **⚡ Auto Apply → Create missing drafts**. |
| FORM / NO_EMAIL | No email to send to — use the form link / message the author. |
| ERROR | Sending failed; see **Notes**. |

## If something goes wrong

| Message | Fix |
|---|---|
| No 📩 buttons on LinkedIn | Reload the page; check the extension is on in `chrome://extensions`. |
| `bad token` | The token in `.env` / the extension must equal Script properties → `SYNC_TOKEN`. |
| `deployment is an old version` | Apps Script: **Deploy → Manage deployments → ✏️ → New version → Deploy**. |
| `ChatGPT limit reached` | Run `npm run process` later; posts stay **NEW** until they're done. |
| ChatGPT not logged in | Run `npm run login` again. |

After editing `Code.gs`, always redeploy as a **New version** (the URL stays the same).
After editing the extension, click **↻ reload** on it in `chrome://extensions`.
