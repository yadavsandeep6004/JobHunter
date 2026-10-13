// A clicked post (from content.js) → one sheet row: emails, form links, post time, stable post ID.
import { cleanText, extractEmails, extractFormLinks, timeFromRelative, timeFromUrn } from "./extract.js";

/**
 * @param {{ urn: string|null, author: string, headline: string, profileUrl: string, postUrl: string,
 *           timeLabel: string, text: string, links: { href: string, text: string }[] }} p
 */
export function toRow(p) {
  const content = cleanText(p.text);
  const linkTexts = p.links.map((l) => l.text).join("\n");
  const mailtos = p.links.filter((l) => l.href.startsWith("mailto:")).map((l) => l.href.slice(7).split("?")[0]);
  const emails = [...new Set([...extractEmails(content), ...extractEmails(linkTexts), ...mailtos.flatMap(extractEmails)])];
  const formLinks = extractFormLinks(content, linkTexts, ...p.links.map((l) => l.href));
  const postedAt = (p.urn && timeFromUrn(p.urn)) || timeFromRelative(p.timeLabel || "");
  return {
    postId: p.urn || `hash:${hash(`${p.profileUrl || p.author}|${content}`.toLowerCase().replace(/\s+/g, " ").slice(0, 600))}`,
    postedAt: postedAt ? postedAt.toISOString() : null,
    author: p.author,
    headline: p.headline,
    profileUrl: p.profileUrl,
    postUrl: p.postUrl,
    emails: emails.join(","),
    formLinks: formLinks.join(","),
    content,
  };
}

/** Stable short ID for posts whose LinkedIn ID isn't on the page (FNV-1a, 2 rounds). */
function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 16777619);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
