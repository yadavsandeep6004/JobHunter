// Pure text helpers shared by the extension and the Node tests: emails, Google Form links, post time.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const FORM_RE = /https?:\/\/(?:forms\.gle\/[A-Za-z0-9_-]+|docs\.google\.com\/forms\/[^\s"'<>)\]]+)/g;

const COMMON_TLDS = ["com", "in", "co", "io", "ai", "net", "org", "dev", "tech", "us", "uk", "pk", "app", "info"];
// real TLDs that start with a common one — never cut these
const LONG_TLDS = new Set([
  "company", "technology", "technologies", "solutions", "services", "consulting", "digital", "software",
  "systems", "agency", "network", "online", "international", "institute", "industries", "info", "inc",
  "comcast", "tech", "app", "careers", "community", "coach", "codes", "cool", "computer", "construction",
]);

/**
 * Finds emails, including light obfuscation like "hr [at] acme [dot] com".
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmails(text) {
  const normalized = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = normalized.match(EMAIL_RE) ?? [];
  const cleaned = found
    .map((e) => e.toLowerCase().replace(/\.+$/, ""))
    // a line break can glue the next word on: "info@x.aiplease" -> "info@x.ai", "hr@x.comsubject" -> "hr@x.com"
    .map(unglueTld)
    // drop image file names and similar false positives
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e));
  return [...new Set(cleaned)];
}

/** @param {string} email */
function unglueTld(email) {
  const m = email.match(/^(.*\.)([a-z]+)$/);
  if (!m || LONG_TLDS.has(m[2])) return email;
  const tld = m[2];
  // longest common TLD that leaves at least 3 extra letters behind ("comsubject" -> "com" + "subject")
  const base = COMMON_TLDS.filter((t) => tld.startsWith(t) && tld.length - t.length >= 3).sort((a, b) => b.length - a.length)[0];
  return base ? m[1] + base : email;
}

/**
 * @param {...string} sources
 * @returns {string[]}
 */
export function extractFormLinks(...sources) {
  const links = sources.flatMap((s) => s.match(FORM_RE) ?? []).map((l) => l.replace(/[.,;]+$/, ""));
  return [...new Set(links)];
}

/**
 * LinkedIn activity / ugcPost / share IDs are snowflake-style: the top 41 bits are the creation time in ms.
 * @param {string} urn
 * @returns {Date | null}
 */
export function timeFromUrn(urn) {
  const m = urn.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
  if (!m) return null;
  const ms = Number(BigInt(m[1]) >> 22n);
  // sanity check: between 2015 and one day from now
  if (ms < 1_420_000_000_000 || ms > Date.now() + 86_400_000) return null;
  return new Date(ms);
}

/**
 * Parses LinkedIn relative times like "5m", "3h", "2d", "1w", "1mo".
 * @param {string} label
 * @param {Date} [now]
 * @returns {Date | null}
 */
export function timeFromRelative(label, now = new Date()) {
  const m = label.trim().toLowerCase().match(/(\d+)\s*(mo|months?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|y|yrs?|years?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const MIN = 60_000;
  let ms;
  if (unit.startsWith("mo")) ms = n * 30 * 24 * 60 * MIN;
  else if (unit.startsWith("m")) ms = n * MIN;
  else if (unit.startsWith("h")) ms = n * 60 * MIN;
  else if (unit.startsWith("d")) ms = n * 24 * 60 * MIN;
  else if (unit.startsWith("w")) ms = n * 7 * 24 * 60 * MIN;
  else ms = n * 365 * 24 * 60 * MIN;
  return new Date(now.getTime() - ms);
}

/**
 * LinkedIn's text sometimes leaks escaped entities ("R&amp;D" shown as "Ramp;D").
 * @param {string} text
 */
export function cleanText(text) {
  return text.replace(/&?amp;/g, "&").replace(/&?nbsp;/g, " ").replace(/&?quot;/g, '"').trim();
}
