// Adds a "📩 Send" button to every LinkedIn post. Nothing happens until you click it:
// then it reads that one post from the page you're already looking at and hands it to background.js.
(() => {
  // The stable hook across LinkedIn's layouts: each post's menu button.
  const MENU_BUTTON = 'button[aria-label^="Open control menu for post"]';
  const POST_CONTAINER = '[data-urn^="urn:li:activity:"], [data-view-name="feed-full-update"], [role="listitem"], article, .feed-shared-update-v2';
  const BODY = '[data-testid="expandable-text-box"], [data-view-name="feed-commentary"], .update-components-text, .feed-shared-inline-show-more-text';
  const URN_RE = /urn(?::|%3A)li(?::|%3A)(activity|ugcPost|share)(?::|%3A)(\d{15,})/;
  const TIME_RE = /^(\d+)\s?(s|m|h|d|w|mo|yr|y)\b/;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el && el.innerText ? el.innerText.trim() : "");

  function addButtons() {
    for (const menu of document.querySelectorAll(MENU_BUTTON)) {
      if (menu.dataset.jhDone) continue;
      menu.dataset.jhDone = "1";
      const post = menu.closest(POST_CONTAINER);
      if (!post) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jh-send";
      btn.textContent = "📩 Send";
      btn.title = "Send this post to your Job Hunter sheet";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        send(btn, post, menu);
      });
      menu.parentElement.insertBefore(btn, menu);
    }
  }

  async function send(btn, post, menu) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "⏳ Sending…";
    try {
      const data = await readPost(post, menu);
      if (!data.text) throw new Error("Couldn't read this post's text");
      const res = await chrome.runtime.sendMessage({ type: "capture", post: data });
      if (!res || !res.ok) throw new Error((res && res.error) || "No answer from the extension");
      const label = { NEW: "✓ Sent · email found", FORM: "✓ Sent · form", NO_EMAIL: "✓ Sent · no email", DUPLICATE: "⚠ Same job already in sheet" };
      btn.classList.add(res.status === "DUPLICATE" ? "jh-warn" : "jh-ok");
      btn.textContent = res.added ? label[res.status] || "✓ Sent" : "✓ Already in sheet";
      btn.title = res.added ? res.note || `Status in sheet: ${res.status}` : "This post is already in your sheet";
    } catch (err) {
      btn.disabled = false;
      btn.classList.add("jh-err");
      btn.textContent = "✗ Retry";
      btn.title = String((err && err.message) || err);
    }
  }

  async function readPost(post, menu) {
    // open "…more" on this post only, so the full text (and any email at the end) is on the page
    for (const b of post.querySelectorAll("button")) {
      const t = text(b);
      const isMore = b.getAttribute("data-testid") === "expandable-text-button" || /^(…|\.\.\.)\s*(see )?more$/i.test(t);
      if (isMore && /more/i.test(t) && b.getAttribute("aria-expanded") !== "true") b.click();
    }
    await sleep(400);

    const urnMatch =
      (post.getAttribute("data-urn") || "").match(URN_RE) ||
      decodeURIComponent(location.href).match(URN_RE) ||
      Array.from(post.querySelectorAll("a[href*='activity'], a[href*='ugcPost']"))
        .map((a) => decodeURIComponent(a.getAttribute("href") || "").match(URN_RE)).find(Boolean);
    const urn = urnMatch ? `urn:li:${urnMatch[1]}:${urnMatch[2]}` : null;

    const author = (menu.getAttribute("aria-label") || "").replace(/^Open control menu for post by\s*/i, "").trim();
    const actor = post.querySelector('[data-view-name="feed-actor"], .update-components-actor__meta-link, a[href*="/in/"], a[href*="/company/"]');
    const profileUrl = actor && actor.href ? actor.href.split("?")[0] : "";

    // header lines: author, "• 3rd+", headline, "27m •", "Follow", ...
    const lines = (post.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => TIME_RE.test(l));
    const authorIdx = lines.indexOf(author);
    const notHeadline = /^([•·]\s*)?(1st|2nd|3rd\+?|out of network)$|^(follow|following|connect|promoted|feed post)$|^[•·]/i;
    const headline = authorIdx >= 0 && timeIdx > authorIdx
      ? lines.slice(authorIdx + 1, timeIdx).find((l) => !notHeadline.test(l) && l !== author) || ""
      : "";

    const bodies = Array.from(post.querySelectorAll(BODY)).map(text).sort((a, b) => b.length - a.length);
    const body = (bodies[0] || "").replace(/\n?…\s*more$/, "").trim();

    const links = Array.from(post.querySelectorAll("a[href]"))
      .map((a) => ({ href: a.href, text: text(a) }))
      .filter((l) => l.href && !l.href.startsWith("javascript"));

    const onPostPage = /\/(feed\/update|posts)\//.test(location.pathname);
    return {
      urn,
      author,
      headline,
      profileUrl,
      timeLabel: timeIdx >= 0 ? lines[timeIdx] : "",
      text: body,
      links,
      postUrl: urn ? `https://www.linkedin.com/feed/update/${urn}/` : onPostPage ? location.href.split("?")[0] : profileUrl,
    };
  }

  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(addButtons, 400);
  }).observe(document.body, { childList: true, subtree: true });
  addButtons();
})();
