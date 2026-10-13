const $ = (id) => document.getElementById(id);

function show(msg, ok) {
  $("status").textContent = msg;
  $("status").className = ok ? "ok" : "err";
}

chrome.storage.local.get(["url", "token"]).then(({ url, token }) => {
  $("url").value = url || "";
  $("token").value = token || "";
});

$("save").addEventListener("click", async () => {
  const url = $("url").value.trim();
  const token = $("token").value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return show("The URL should look like https://script.google.com/macros/s/…/exec", false);
  if (!token) return show("Paste the sync token.", false);
  await chrome.storage.local.set({ url, token });
  show("Saved ✓ — now click Test connection.", true);
});

$("test").addEventListener("click", async () => {
  show("Testing…", true);
  const res = await chrome.runtime.sendMessage({ type: "ping" });
  if (res && res.ok) show("Connected to your sheet ✓ — open LinkedIn and look for the 📩 Send buttons.", true);
  else show(`Not connected: ${(res && res.error) || "no answer"}`, false);
});
