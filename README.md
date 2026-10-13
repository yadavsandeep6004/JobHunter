# Job Hunter

Free job-application helper — you pick the posts, it writes and drafts the emails:

```
LinkedIn (you browse)  → click 📩 Send on a post (Chrome extension)
                           → Google Sheet "Jobs": NEW / FORM / NO_EMAIL
npm run process        → ChatGPT tab: fit or not, which CV, which email, subject + message
                           → sheet creates the Gmail draft with the matching CV
You                    → review drafts, tick Approve, ⚡ Auto Apply → Send approved drafts
```

**Setup and daily steps: [docs/start.md](docs/start.md)**

## Project layout

| Path | What |
|---|---|
| `extension/` | Chrome extension: the 📩 Send button (`content.js`) and the sheet call (`background.js`). |
| `extension/lib/` | Email / form-link / post-time parsing — shared with the Node tests. |
| `apps-script/Code.gs` | Google Sheet side: stores posts, creates Gmail drafts, sends approved ones. |
| `src/process.ts` | Reads NEW posts from the sheet, asks ChatGPT, sends the answers back. |
| `src/chatgpt/` | Drives chatgpt.com in the project's Chrome; the prompt and reply parsing. |
| `config/profile.md` | Your details — the only facts ChatGPT may use. |
| `config/settings.json` | ChatGPT pacing (posts per chat, timeouts, delays). |

Nothing automated runs on LinkedIn: the extension only reads a post when you click its button.
