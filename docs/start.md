# Job Hunter — Complete Setup Guide

**What it does:** you browse LinkedIn and click **📩 Send** on hiring posts you like. ChatGPT reads each
post, decides if it fits you, picks your Frontend / Backend / Full Stack CV and writes a short email.
A Gmail draft with that CV attached appears — you read it and send it yourself.

```
LinkedIn (you browse) ──📩──▶ Google Sheet "Jobs" ──npm run process──▶ ChatGPT ──▶ Gmail draft + CV ──▶ you send
```

Nothing runs automatically on LinkedIn, and nothing is ever sent without you.

---

## What you need

- A Mac / Windows / Linux computer with **Google Chrome** and **Node.js 22+** (nodejs.org).
- A **Google account** (Sheets, Drive, Gmail) and a **ChatGPT account** (the free plan works).
- Your CV as **3 PDFs**: frontend, backend and full stack (the same CV 3 times is fine too).

## Setup (once, about 15 minutes)

### 1. Project
1. Download / clone this project, open a terminal in its folder and run `npm install`.
2. Copy `config/profile.example.md` to `config/profile.md` and fill in your details and the **Looking for** line.
   ChatGPT only uses facts from this file (it stays on your computer, never committed).

### 2. Google Drive
3. Upload your 3 CV PDFs to Google Drive (keep them private).

### 3. Google Sheet + script
4. Create a new Google Sheet → **Extensions → Apps Script**.
5. Delete what's in `Code.gs`, paste all of `apps-script/Code.gs`, set `MY_NAME` (line 13) to your name → **Save** 💾.
6. Back in the sheet, reload the page → menu **⚡ Auto Apply → ⚙️ Setup**.
7. Google asks for permission → your account → **Advanced → Go to … (unsafe) → Allow** (it's your own script).
8. Paste the Drive links of your 3 CVs when asked → copy the **sync token** shown at the end.
   A **Jobs** tab is created — it's the only tab the flow uses.

### 4. Publish the script (so the extension and your computer can reach it)
9. In Apps Script: **Deploy → New deployment → ⚙️ → Web app**.
10. Execute as **Me**, Who has access **Anyone** → **Deploy** → copy the **Web app URL** (ends in `/exec`).
    "Anyone" only means reachable — every request must carry your secret sync token.

### 5. Connect your computer
11. In the project folder run `cp .env.example .env` (Windows: `copy .env.example .env`).
12. Open `.env` and paste the Web app URL and the sync token.

### 6. Chrome extension (the 📩 button)
13. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `extension` folder.
14. Pin it (🧩 menu → 📌), click its icon → paste the same URL and token → **Save** → **Test connection** ✓.
    Other browsers: see [Other browsers](#other-browsers).

### 7. ChatGPT
15. Run `npm run login` → a Chrome window opens → log in to ChatGPT → quit that window (**Cmd+Q** / close it).

### 8. Try it once
16. On LinkedIn, click **📩 Send** on one hiring post that has an email → a row appears in **Jobs**.
17. Run `npm run process` → that row turns **DRAFTED** and a draft with your CV appears in Gmail.

---

## Daily use

1. Browse LinkedIn (e.g. search *hiring react developer* → **Posts**, **Latest**) and click **📩 Send** on good posts.
2. Run `npm run process` — ChatGPT writes the emails; Gmail drafts appear with the right CV.
3. Open Gmail → **Drafts**, read each one, edit if needed, and press **Send** on the ones you want.

Tip: 10–30 posts a day at a normal pace. Posts with an email in them are the ones that become emails.

## The 📩 button

| Button shows | Meaning |
|---|---|
| ✓ Sent · email found | Saved as **NEW** — `npm run process` will write the email. |
| ✓ Sent · form | Saved as **FORM** — apply through the form link yourself. |
| ✓ Sent · no email | Saved as **NO_EMAIL** — message the author on LinkedIn. |
| ⚠ Same job already in sheet | Same JD as a post you already sent — saved as **DUPLICATE**, no email. |
| ✓ Already in sheet | You clicked this exact post before. |
| ✗ Retry | Hover it to see why (usually settings or the deployment). |

## Sheet "Jobs" — Status column

| Status | Meaning |
|---|---|
| NEW | Has an email; waiting for `npm run process`. |
| DRAFTED | Gmail draft with the right CV is ready — read and send it from Gmail. |
| SKIPPED | ChatGPT says it isn't a fit (reason in **Notes**). |
| DUPLICATE | Same job or same email as another row — never gets a second email. |
| READY | Email written but the draft failed → **⚡ Auto Apply → Create missing drafts**. |
| FORM / NO_EMAIL | No email to send to — use the form link / message the author. |

## Commands

| Command | What it does |
|---|---|
| `npm run login` | Log in to ChatGPT in the project's own Chrome profile. |
| `npm run process` | NEW posts → ChatGPT → Gmail drafts. Safe to run any time; it continues where it stopped. |
| `npm test` | Unit tests (parsing, prompt, ChatGPT reply). |
| `npm run test:extension` | Extension test on a fake LinkedIn page (first time: `npx playwright install chromium`). |

## Other browsers

| Browser | Install the extension |
|---|---|
| Edge / Brave / Arc / Opera / Vivaldi | Same as Chrome via their extensions page (`edge://extensions`, `brave://extensions`, …). |
| Firefox | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `extension/manifest.json`, |
|  | then `about:addons` → Job Hunter → **Permissions** → allow linkedin.com and google.com (removed on restart). |
| Safari | Not supported — use one of the browsers above. |

`npm run process` always uses the project's own Chrome for ChatGPT, whatever browser you click 📩 in.

## If something goes wrong

| Problem | Fix |
|---|---|
| No 📩 buttons on LinkedIn | Reload the page; check the extension is on in `chrome://extensions`. |
| `bad token` | Token in `.env` and the extension must equal Apps Script → Project Settings → Script properties → `SYNC_TOKEN`. |
| `deployment is an old version` | Apps Script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. |
| `ChatGPT limit reached` | Run `npm run process` later — posts stay **NEW** until they're done. |
| ChatGPT not logged in | Run `npm run login` again. |
| Wrong CV / tone in emails | Edit `config/profile.md` (facts + "Looking for"); prompt rules are in `src/chatgpt/prompt.ts`. |

## Updating

- Changed `apps-script/Code.gs`? Paste it again → **Save** → **Deploy → Manage deployments → ✏️ → New version → Deploy**.
  The URL stays the same.
- Changed the `extension` folder? `chrome://extensions` → **↻** on Job Hunter → reload LinkedIn.
