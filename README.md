# Job Hunter — Step 1: Daily LinkedIn hiring-post collector

Each run collects LinkedIn **posts** published since the **last successful run**
(first run: last 24h), keeps the ones that match your profile, and stores
**author name, headline, profile URL, emails, Google Form links and full content** in SQLite.

100% free: Node + Playwright (your installed Chrome) + built-in `node:sqlite`.

## Setup (once)

```bash
cd ~/Desktop/project/learning/job-hunter
npm install
npm run login        # normal Chrome opens → log in (Google sign-in works) → quit that Chrome with Cmd+Q
```

## Daily use

```bash
npm run collect      # collect new matching posts since last run
npm run posts        # show posts from the latest run
npm run posts -- --all
npm run runs         # run history (window, scanned, matched, inserted)
npm run rematch      # after editing config/search.json: re-apply filters to saved posts
npm run export       # CSV → exports/posts-YYYY-MM-DD.csv
```

Run automatically every day (macOS):

```bash
./scripts/install-daily.sh 9 0       # every day at 09:00 (runs on wake if the Mac was asleep)
./scripts/install-daily.sh --uninstall
```

## How the "since last run" window works

- `runs` table stores each run's start time and status.
- New run window = last **successful** run's start − 15 min overlap → now.
- For each matching post the collector uses LinkedIn's own "Copy link to post", follows the short link to get the post ID,
  and decodes the exact post time from it (other posts use the "27m / 3h" label).
- Each search query scrolls (latest first) until it hits 8 posts older than the window.
- Duplicate posts are ignored (unique `post_urn`), so overlaps are safe.
- A failed run doesn't move the window — the next run re-covers it.

## Tuning — `config/search.json`

| Key | Meaning |
|---|---|
| `queries` | LinkedIn post searches to run |
| `skills` / `minSkillMatches` | post must mention at least N of these |
| `hiringSignals` | post must look like a hiring post |
| `exclude` | drop job-seeker / spam / US-staffing posts (also checked against author name + headline) |
| `otherStacks` / `minSkillsIfOtherStack` | e.g. "Java Full Stack": kept only if it also lists ≥ 4 of your skills |
| `homeLocations` / `foreignLocations` | India + Remote: a post naming a foreign place is dropped unless it also names India / an Indian city / remote / ₹ / LPA. No location → kept |
| `myExperienceYears` + `experienceTolerance` | drop posts asking for more experience (4 + 1 → max 5 yrs minimum) |
| `requireContact` | `true` = only keep posts with an email or Google Form |
| `maxPostsPerQuery`, `delayMs` | keep these modest to stay human-paced |

## Data

`data/jobs.db` → tables `runs` and `posts` (`status`: new / emailed / form_filled / skipped — used by the next steps).

If a search page shows no posts, a screenshot + HTML is saved to `debug/` (LinkedIn changes its markup sometimes).
If no search shows any posts, the run is marked failed so the time window doesn't move.

Login: `npm run login` opens normal Chrome (no automation) on a separate profile in `.browser-profile/`, so
"Sign in with Google" works. `npm run collect` closes that window automatically if you left it open.

## Next steps (roadmap)

2. Email sender (Gmail SMTP, CV picked FE/BE/FS) · 3. Google Form filler · 4. Google Sheet log with date · 5. Review dashboard
