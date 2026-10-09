import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEmails, extractFormLinks, minExperienceYears, timeFromRelative, timeFromUrn } from "./extract.ts";
import { matchPost } from "./match.ts";
import { loadConfig } from "./config.ts";

test("extracts plain and obfuscated emails", () => {
  const t = "Send CV to HR@Acme.com. Or careers [at] foo [dot] io, banner.png@2x.png";
  assert.deepEqual(extractEmails(t), ["hr@acme.com", "careers@foo.io"]);
  assert.deepEqual(extractEmails("mail info@elternsegen.aiplease share"), ["info@elternsegen.ai"]);
  assert.deepEqual(extractEmails("hr@company.com"), ["hr@company.com"]);
});

test("extracts google form links", () => {
  assert.deepEqual(
    extractFormLinks("Apply: https://forms.gle/AbC123xyz. thanks", "https://docs.google.com/forms/d/e/1FAIp/viewform?usp=sf"),
    ["https://forms.gle/AbC123xyz", "https://docs.google.com/forms/d/e/1FAIp/viewform?usp=sf"],
  );
});

test("decodes post time from activity URN", () => {
  // 7300000000000000000 >> 22 ≈ 2025-02
  const d = timeFromUrn("urn:li:activity:7300000000000000000");
  assert.ok(d && d.getUTCFullYear() === 2025);
  assert.equal(timeFromUrn("urn:li:fsd_profile:abc"), null);
});

test("parses relative times", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  assert.equal(timeFromRelative("5h •", now)?.toISOString(), "2026-10-07T07:00:00.000Z");
  assert.equal(timeFromRelative("2d", now)?.toISOString(), "2026-10-05T12:00:00.000Z");
  assert.equal(timeFromRelative("1mo", now)?.toISOString(), "2026-09-07T12:00:00.000Z");
});

test("finds minimum experience", () => {
  assert.equal(minExperienceYears("Exp: 3-5 years, or 6+ yrs lead")?.min, 3);
  assert.equal(minExperienceYears("Experience 7+ years")?.min, 7);
  assert.equal(minExperienceYears("no exp mentioned"), null);
});

test("matches hiring posts and rejects job seekers / senior roles", () => {
  const cfg = loadConfig();
  const none = { emails: [], formLinks: [] };
  assert.equal(matchPost("We are hiring a React.js developer, 2-4 years. Send your CV to hr@x.com", cfg, { emails: ["hr@x.com"], formLinks: [] }).ok, true);
  assert.equal(matchPost("#OpenToWork I am looking for a job as React developer", cfg, none).ok, false);
  assert.equal(matchPost("Hiring Node.js architect with 10+ years", cfg, none).ok, false);
  assert.equal(matchPost("Hiring Java Spring developer", cfg, none).ok, false);
  assert.equal(matchPost("#Hiring Java Engineer / Java Full Stack: Spring Boot, React", cfg, none).ok, false);
  assert.equal(matchPost("Hiring Full Stack Java Developer, React. W2 only", cfg, none).ok, false);
  assert.equal(matchPost("I lost a job last week because I didn't have a CV. React, Next.js", cfg, none).ok, false);
  assert.equal(matchPost("Hiring React + Node developer, send resume", cfg, none, "US IT Recruiter | C2C, W2, H1B").ok, false);
  assert.equal(matchPost("Hiring React + Node.js developer. Location: Karachi. Send CV", cfg, none).ok, false);
  assert.equal(matchPost("Hiring React + Node.js developer, Columbus, OH. Send CV", cfg, none).ok, false);
  assert.equal(matchPost("Hiring React + Node.js developer, Plano, TX. Send CV", cfg, none).ok, false);
  assert.equal(matchPost("Hiring React + Node.js developer, Remote (USA). Send CV", cfg, none).ok, true);
  assert.equal(matchPost("Hiring React + Node.js developer in Pune, 8-12 LPA. Send CV", cfg, none).ok, true);
  assert.equal(matchPost("We're hiring MERN developers: React, Node.js, MongoDB. Share your CV", cfg, none).ok, true);
});
