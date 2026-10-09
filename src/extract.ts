// Pure text helpers: emails, Google Form links, post time, experience.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const FORM_RE = /https?:\/\/(?:forms\.gle\/[A-Za-z0-9_-]+|docs\.google\.com\/forms\/[^\s"'<>)\]]+)/g;

/** Finds emails, including light obfuscation like "hr [at] acme [dot] com". */
export function extractEmails(text: string): string[] {
  const normalized = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = normalized.match(EMAIL_RE) ?? [];
  const cleaned = found
    .map((e) => e.toLowerCase().replace(/\.+$/, ""))
    // a line break can glue the next word on: "info@x.aiplease" -> "info@x.ai"
    .map((e) => e.replace(/\.([a-z]{2,4}?)(please|thanks|thank|regards|and|or|for|with|to|or)$/, ".$1"))
    // drop image file names and similar false positives
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e));
  return [...new Set(cleaned)];
}

export function extractFormLinks(...sources: string[]): string[] {
  const links = sources.flatMap((s) => s.match(FORM_RE) ?? []).map((l) => l.replace(/[.,;]+$/, ""));
  return [...new Set(links)];
}

/**
 * LinkedIn activity / ugcPost / share IDs are snowflake-style:
 * the top 41 bits are the creation time in ms since epoch.
 */
export function timeFromUrn(urn: string): Date | null {
  const m = urn.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
  if (!m) return null;
  const ms = Number(BigInt(m[1]) >> 22n);
  // sanity check: between 2015 and one day from now
  if (ms < 1_420_000_000_000 || ms > Date.now() + 86_400_000) return null;
  return new Date(ms);
}

/** Parses LinkedIn relative times like "5m", "3h", "2d", "1w", "1mo", "2 hours ago". */
export function timeFromRelative(label: string, now = new Date()): Date | null {
  const m = label.trim().toLowerCase().match(/(\d+)\s*(mo|months?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|y|yrs?|years?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const MIN = 60_000;
  let ms: number;
  if (unit.startsWith("mo")) ms = n * 30 * 24 * 60 * MIN;
  else if (unit.startsWith("m")) ms = n * MIN;
  else if (unit.startsWith("h")) ms = n * 60 * MIN;
  else if (unit.startsWith("d")) ms = n * 24 * 60 * MIN;
  else if (unit.startsWith("w")) ms = n * 7 * 24 * 60 * MIN;
  else ms = n * 365 * 24 * 60 * MIN;
  return new Date(now.getTime() - ms);
}

/**
 * Returns the smallest "minimum years" a post asks for, e.g.
 * "3-5 years" -> 3, "5+ yrs" -> 5, "2 to 4 years" -> 2. null if none mentioned.
 */
export function minExperienceYears(text: string): { min: number; text: string } | null {
  const re = /(\d{1,2}(?:\.\d)?)\s*(?:\+|\s*(?:-|–|to)\s*\d{1,2}(?:\.\d)?\s*\+?)?\s*(?:years?|yrs?|yoe)\b/gi;
  let best: { min: number; text: string } | null = null;
  for (const m of text.matchAll(re)) {
    const min = Number(m[1]);
    if (min > 30) continue;
    if (!best || min < best.min) best = { min, text: m[0].trim() };
  }
  return best;
}

/** LinkedIn's text sometimes leaks escaped entities ("R&amp;D" shown as "Ramp;D"). */
export function cleanText(text: string): string {
  return text.replace(/&?amp;/g, "&").replace(/&?nbsp;/g, " ").replace(/&?quot;/g, '"').trim();
}
