import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEmails, extractFormLinks, timeFromRelative, timeFromUrn } from "../extension/lib/extract.js";
import { toRow } from "../extension/lib/row.js";

test("extracts plain, obfuscated and glued emails", () => {
  assert.deepEqual(extractEmails("Send CV to HR@Acme.com. Or careers [at] foo [dot] io, banner.png@2x.png"), ["hr@acme.com", "careers@foo.io"]);
  assert.deepEqual(extractEmails("mail info@elternsegen.aiplease share"), ["info@elternsegen.ai"]);
  assert.deepEqual(extractEmails("Email: hr@bizaffix.comSubject: React"), ["hr@bizaffix.com"]);
  assert.deepEqual(extractEmails("a@x.technology b@y.solutions c@z.info d@w.io"), ["a@x.technology", "b@y.solutions", "c@z.info", "d@w.io"]);
});

test("extracts google form links", () => {
  assert.deepEqual(
    extractFormLinks("Apply: https://forms.gle/AbC123xyz. thanks", "https://docs.google.com/forms/d/e/1FAIp/viewform?usp=sf"),
    ["https://forms.gle/AbC123xyz", "https://docs.google.com/forms/d/e/1FAIp/viewform?usp=sf"],
  );
});

test("post time from URN and from relative labels", () => {
  assert.equal(timeFromUrn("urn:li:activity:7300000000000000000")?.getUTCFullYear(), 2025);
  assert.equal(timeFromUrn("urn:li:fsd_profile:abc"), null);
  const now = new Date("2026-10-07T12:00:00Z");
  assert.equal(timeFromRelative("5h •", now)?.toISOString(), "2026-10-07T07:00:00.000Z");
  assert.equal(timeFromRelative("1mo", now)?.toISOString(), "2026-09-07T12:00:00.000Z");
});

test("a clicked post becomes a sheet row", () => {
  const base = { author: "Priya", headline: "HR @ Acme", profileUrl: "https://www.linkedin.com/in/priya", timeLabel: "3h •" };
  const row = toRow({
    ...base, urn: "urn:li:activity:7513653077225193472", postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7513653077225193472/",
    text: "We're hiring React devs. Apply: https://forms.gle/abc123 R&amp;D team",
    links: [{ href: "mailto:jobs@acme.in", text: "jobs@acme.in" }],
  });
  assert.equal(row.postId, "urn:li:activity:7513653077225193472");
  assert.equal(row.emails, "jobs@acme.in");
  assert.equal(row.formLinks, "https://forms.gle/abc123");
  assert.match(row.content, /R&D team/);
  assert.ok(row.postedAt?.startsWith("2026-"));

  // no LinkedIn ID on the page → stable content hash, same post gives the same ID
  const a = toRow({ ...base, urn: null, postUrl: "", text: "Hiring Node dev", links: [] });
  const b = toRow({ ...base, urn: null, postUrl: "", text: "Hiring  Node dev", links: [] });
  assert.match(a.postId, /^hash:[0-9a-f]{16}$/);
  assert.equal(a.postId, b.postId);
  assert.equal(a.emails, "");
});
