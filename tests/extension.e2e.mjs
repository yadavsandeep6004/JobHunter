// Loads the extension in Playwright's Chromium against a FAKE LinkedIn page and a FAKE sheet
// (nothing real is touched) and checks the 📩 button end to end.  Run: npm run test:extension
// First time only: npx playwright install chromium   (or set CHROMIUM_PATH to a Chromium you already have)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EXT = fileURLToPath(new URL("../extension", import.meta.url));
const MOCK = `<!doctype html><html><head><meta charset="utf-8"></head><body><main>
<div role="list">
  <!-- new search layout (no post ID in the page) -->
  <div role="listitem"><div>
    <p>Feed post</p>
    <a href="https://www.linkedin.com/in/priya-hr/?mini=1"><p>Priya Sharma</p></a><p>• 3rd+</p><p>HR @ Acme Tech</p><p>3h •</p>
    <div><button aria-label="Open control menu for post by Priya Sharma">⋯</button></div>
    <div data-testid="expandable-text-box">We are hiring React + Node.js developers (3-5 yrs), Pune.</div>
    <button data-testid="expandable-text-button" onclick="this.previousElementSibling.innerText += ' Send your CV to jobs@acmetech.in'; this.remove()">… more</button>
  </div></div>
  <!-- legacy layout with the post ID -->
  <div data-urn="urn:li:activity:7513653077225193472" class="feed-shared-update-v2">
    <a class="update-components-actor__meta-link" href="https://www.linkedin.com/company/foo/">Foo Corp</a>
    <div><button aria-label="Open control menu for post by Foo Corp">⋯</button></div>
    <div class="update-components-text">Hiring frontend devs! Apply here: <a href="https://lnkd.in/x">https://forms.gle/Abc123</a></div>
  </div>
</div></main></body></html>`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "jh-ext-")), {
  executablePath: process.env.CHROMIUM_PATH || undefined, // optional: use an already-installed Chromium
  headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const sent = [];
await ctx.route("https://script.google.com/**", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  sent.push(body);
  const row = body.rows && body.rows[0];
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body.action === "ping" ? { ok: true } :
    { ok: true, added: sent.filter(s => s.rows && s.rows[0].postId === row.postId).length === 1 ? 1 : 0, status: row.emails ? "NEW" : row.formLinks ? "FORM" : "NO_EMAIL" }) });
});
await ctx.route("https://www.linkedin.com/**", (route) => route.fulfill({ contentType: "text/html", body: MOCK }));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate(() => chrome.storage.local.set({ url: "https://script.google.com/macros/s/TEST/exec", token: "tok-123" }));

const page = await ctx.newPage();
await page.goto("https://www.linkedin.com/search/results/content/?keywords=hiring");
await page.waitForSelector(".jh-send", { timeout: 10000 });
const btns = page.locator(".jh-send");
assert.equal(await btns.count(), 2, "a 📩 button on each post");

const clickAndWait = async (i) => {
  await btns.nth(i).click();
  await page.waitForFunction((i) => !/Sending/.test(document.querySelectorAll(".jh-send")[i].textContent), i, { timeout: 15000 });
  return btns.nth(i).textContent();
};
assert.equal(await clickAndWait(0), "✓ Sent · email found");
assert.equal(await clickAndWait(1), "✓ Sent · form");

const [first, second] = sent.filter((s) => s.action === "capture").map((s) => s.rows[0]);
assert.equal(first.author, "Priya Sharma");
assert.equal(first.headline, "HR @ Acme Tech");
assert.equal(first.emails, "jobs@acmetech.in", "email hidden behind '…more' is found");
assert.match(first.postId, /^hash:/);
assert.equal(second.postId, "urn:li:activity:7513653077225193472");
assert.equal(second.formLinks, "https://forms.gle/Abc123");
assert.equal(sent[0].token, "tok-123");

// same post again → same ID → "Already in sheet"
await page.evaluate(() => { document.querySelector(".jh-send").disabled = false; });
assert.equal(await clickAndWait(0), "✓ Already in sheet");
assert.equal(sent.filter((s) => s.action === "capture")[2].rows[0].postId, first.postId);

await ctx.close();
console.log("✓ extension test passed");
