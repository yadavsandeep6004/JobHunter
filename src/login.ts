// One-time manual login in normal Chrome (no automation, so Google sign-in works).
// Log in to LinkedIn (tab 1) and ChatGPT (tab 2), then QUIT that Chrome window (Cmd+Q). We then verify.
import { firstPage, isChallengeUrl, isLoggedOutUrl, launchPlainChrome, openBrowser, sleep } from "./browser.ts";

console.log("\nOpening Chrome (separate job-hunter profile)...");
console.log("1. Tab 1: log in to LinkedIn — email/password or 'Sign in with Google' both work.");
console.log("2. Tab 2: log in to ChatGPT (recommended — works logged out too, but with lower limits).");
console.log("3. Then quit that Chrome window with Cmd+Q.\n");

const chrome = launchPlainChrome("https://www.linkedin.com/login", "https://chatgpt.com/auth/login");
await new Promise<void>((resolve) => chrome.on("exit", () => resolve()));

console.log("Chrome closed. Checking the LinkedIn session...");
await sleep(1500);

const session = await openBrowser({ headless: true });
const page = await firstPage(session.context);
await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
await sleep(3000);
const url = page.url();
await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
await sleep(4000);
const gptLoggedOut = await page.getByRole("button", { name: /^log in$/i }).count().catch(() => 0);
await session.close();

if (isLoggedOutUrl(url) || isChallengeUrl(url)) {
  console.error("✗ Not logged in yet. Run `npm run login` again and finish logging in before quitting Chrome.");
  process.exit(1);
}
console.log("✓ LinkedIn: logged in.");
console.log(gptLoggedOut ? "• ChatGPT: not logged in — it still works, with lower limits. Run `npm run login` again to log in." : "✓ ChatGPT: logged in.");
console.log("Now run:  npm run collect");
