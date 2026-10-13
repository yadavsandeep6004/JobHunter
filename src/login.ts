// One-time ChatGPT login in the project's own Chrome profile (normal Chrome, so Google sign-in works).
// Log in, then QUIT that Chrome window (Cmd+Q). We then check the session.
import { firstPage, launchPlainChrome, openBrowser, sleep } from "./browser.ts";

console.log("\nOpening Chrome (the project's own profile)...");
console.log("1. Log in to ChatGPT.");
console.log("2. Quit that Chrome window with Cmd+Q.\n");

const chrome = launchPlainChrome("https://chatgpt.com/auth/login");
await new Promise<void>((resolve) => chrome.on("exit", () => resolve()));

console.log("Chrome closed. Checking the ChatGPT session...");
await sleep(1500);
const session = await openBrowser({ headless: true });
const page = await firstPage(session.context);
await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
await sleep(4000);
const loggedOut = await page.getByRole("button", { name: /^log in$/i }).count().catch(() => 0);
await session.close();

console.log(loggedOut
  ? "• ChatGPT: not logged in — it still works, with lower limits. Run `npm run login` again to log in."
  : "✓ ChatGPT: logged in. Now run:  npm run process");
