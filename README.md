# Job Hunter

Free daily job-application helper:

```
npm run collect
 ├─ Chrome tab 1: LinkedIn  → hiring posts since the last run that match config/search.json
 ├─ Chrome tab 2: ChatGPT   → per post: fit or not, which CV, which email, subject + message (JSON)
 └─ Google Sheet "Jobs"     → row per post + Gmail draft with the matching CV attached
You review the drafts, tick Approve, and send from the sheet menu.
```

**Setup and daily steps: [docs/start.md](docs/start.md)**

## Project layout

| Path | What |
|---|---|
| `config/profile.md` | Your details — the only facts ChatGPT may use. |
| `config/search.json` | LinkedIn queries, skills, filters, ChatGPT pacing. |
| `src/collect.ts` | Daily run: LinkedIn search → local DB → `process.ts`. |
| `src/linkedin/` | Reads posts from LinkedIn search pages. |
| `src/match.ts`, `src/extract.ts` | Filters (skills, experience, location) and email / form-link parsing. |
| `src/chatgpt/` | Drives chatgpt.com in a tab; the prompt and reply parsing. |
| `src/process.ts`, `src/push.ts` | Sends each post + ChatGPT's answer to the Google Sheet. |
| `apps-script/Code.gs` | Google Sheet side: receives rows, creates Gmail drafts, sends approved ones. |
| `data/jobs.db` | Local SQLite: collected posts and which were sent to the sheet (ChatGPT answers live only in the sheet). |

LinkedIn and ChatGPT don't allow automated use of their sites — keep it to one run a day.
