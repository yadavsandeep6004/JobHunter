# Job Hunter

## How to Run

Run all commands from the project folder:

```bash
cd ~/Desktop/project/learning/job-hunter
```

### 1. Login to LinkedIn

Already completed, so skip this step; if needed later, run `npm run login`, log in through Chrome, then quit Chrome with **Cmd + Q**.

### 2. Collect Posts

Run `npm run collect` and leave the Chrome window untouched while it automatically collects posts for about 15–25 minutes.

### 3. View Results

Run `npm run posts` to view the collected posts.

### 4. Export Results

Run `npm run export` to export the results as a CSV file inside the `exports/` folder for Excel or Google Sheets.

## Run Automatically Every Day

Run `./scripts/install-daily.sh 9 0` to automatically collect posts every morning at **9:00 AM**.

If the Mac is asleep at 9:00 AM, the task will run when the Mac wakes up.

### Disable Automatic Runs

Run `./scripts/install-daily.sh --uninstall` to stop the daily automatic collection.

## Update Existing Posts

The 88 saved posts were collected before the **India + Remote** settings were added.

Run `npm run rematch` whenever you change settings in `config/search.json`, such as skills, experience, or locations.

## Quick Commands

```bash
# Collect posts
npm run collect

# View results
npm run posts

# Export results
npm run export

# Update existing posts after changing search settings
npm run rematch

# Enable daily collection at 9:00 AM
./scripts/install-daily.sh 9 0

# Disable daily collection
./scripts/install-daily.sh --uninstall
```
## Google Sheet + Emails

One-time setup: follow [apps-script/SETUP.md](../apps-script/SETUP.md).

After that, every day:

1. `npm run collect` — new posts also go to the **Jobs** tab in the sheet automatically.
2. Sheet → **⚡ Auto Apply → 1. Write emails** — Gmail drafts with the right CV (Frontend / Backend / Full Stack).
3. Check Gmail **Drafts**, then tick **Approve** in the sheet.
4. Sheet → **⚡ Auto Apply → 2. Send approved drafts**.

Push manually (e.g. if the sheet was down): `npm run push`
