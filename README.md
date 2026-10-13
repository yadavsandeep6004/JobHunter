# Job Hunter

Free job-application helper — you pick the posts, it writes the emails, you send them:

```
LinkedIn (you browse)  → click 📩 Send on a post (Chrome extension) → Google Sheet "Jobs"
npm run process        → ChatGPT: fit or not, which CV, which email, subject + message
                       → Gmail draft with the matching CV attached
You                    → read the drafts in Gmail and send the good ones
```

**Setup and daily use: [docs/start.md](docs/start.md)**

## Project layout

| Path | What |
|---|---|
| `extension/` | Chrome extension: the 📩 button (`content.js`), sheet call (`background.js`), settings page. |
| `extension/lib/` | Email / form-link / post-time parsing, shared with the tests. |
| `apps-script/Code.gs` | Google Sheet side: stores posts, spots duplicate jobs, creates Gmail drafts with the CV. |
| `src/process.ts` | Reads NEW posts from the sheet, asks ChatGPT, sends the answers back. |
| `src/chatgpt/` | Drives chatgpt.com in the project's Chrome; the prompt and reply parsing. |
| `src/login.ts` | One-time ChatGPT login in the project's Chrome profile. |
| `config/profile.md` | Your details — the only facts ChatGPT may use. |
| `config/settings.json` | ChatGPT pacing (posts per chat, timeouts, delays). |

Nothing automated runs on LinkedIn: the extension only reads a post when you click its button,
and nothing is emailed until you press Send in Gmail.
