// One-time manual login in normal Chrome (no automation, so Google sign-in works).
// Log in to LinkedIn, then QUIT that Chrome window (Cmd+Q). We then verify the session.
import { firstPage, isChallengeUrl, isLoggedOutUrl, launchPlainChrome, openBrowser, sleep } from "./browser.ts";

console.log("\nOpening Chrome (separate job-hunter profile)...");
console.log("1. Log in to LinkedIn there — email/password or 'Sign in with Google' both work.");
console.log("2. When your LinkedIn feed shows, quit that Chrome window with Cmd+Q.\n");

const chrome = launchPlainChrome("https://www.linkedin.com/login");
await new Promise<void>((resolve) => chrome.on("exit", () => resolve()));

console.log("Chrome closed. Checking the LinkedIn session...");
await sleep(1500);

const session = await openBrowser({ headless: true });
const page = await firstPage(session.context);
await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
await sleep(3000);
const url = page.url();
await session.close();

if (isLoggedOutUrl(url) || isChallengeUrl(url)) {
  console.error("✗ Not logged in yet. Run `npm run login` again and finish logging in before quitting Chrome.");
  process.exit(1);
}
console.log("✓ Logged in. Session saved. Now run:  npm run collect");
