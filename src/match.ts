import type { SearchConfig } from "./config.ts";
import { minExperienceYears } from "./extract.ts";

export interface MatchResult {
  ok: boolean;
  reason: string;
  matchedSkills: string[];
  score: number;
  experienceText: string | null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive phrase match ("node" must not match "nodemon"). */
function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.toLowerCase();
  // word boundaries only where the phrase itself starts/ends with a letter or digit (", tx" or "₹" need none)
  const pre = /^[a-z0-9]/.test(p) ? "(?<![a-z0-9])" : "";
  const post = /[a-z0-9]$/.test(p) ? "(?![a-z0-9])" : "";
  return new RegExp(`${pre}${escapeRe(p)}${post}`, "i").test(text);
}

export function matchPost(
  text: string,
  cfg: SearchConfig,
  contact: { emails: string[]; formLinks: string[] },
  /** Author name + headline — recruiters often put "C2C / W2 / H1B" there, not in the post. */
  authorInfo = "",
): MatchResult {
  const lower = text.toLowerCase();
  const none = { matchedSkills: [], score: 0, experienceText: null };

  const excluded = cfg.exclude.find((p) => hasPhrase(lower, p) || hasPhrase(authorInfo, p));
  if (excluded) return { ok: false, reason: `excluded: "${excluded}"`, ...none };

  if (!cfg.hiringSignals.some((p) => hasPhrase(lower, p))) {
    return { ok: false, reason: "no hiring signal", ...none };
  }

  const matchedSkills = cfg.skills.filter((s) => hasPhrase(lower, s));
  if (matchedSkills.length < cfg.minSkillMatches) {
    return { ok: false, reason: "no matching skills", ...none };
  }

  // e.g. "Java Full Stack (React)" — only keep if it is clearly also a JS-stack role
  const otherStack = cfg.otherStacks.find((p) => hasPhrase(lower, p));
  if (otherStack && matchedSkills.length < cfg.minSkillsIfOtherStack) {
    return { ok: false, reason: `other stack: "${otherStack}"`, ...none };
  }

  const foreign = cfg.foreignLocations.find((p) => hasPhrase(lower, p));
  if (foreign && !cfg.homeLocations.some((p) => hasPhrase(lower, p))) {
    return { ok: false, reason: `location: "${foreign.replace(/^, /, "")}"`, matchedSkills, score: 0, experienceText: null };
  }

  const exp = minExperienceYears(text);
  if (exp && exp.min > cfg.myExperienceYears + cfg.experienceTolerance) {
    return { ok: false, reason: `needs ${exp.text}`, matchedSkills, score: 0, experienceText: exp.text };
  }

  const hasContact = contact.emails.length > 0 || contact.formLinks.length > 0;
  if (cfg.requireContact && !hasContact) {
    return { ok: false, reason: "no email / form link", matchedSkills, score: 0, experienceText: exp?.text ?? null };
  }

  // Simple score: skills matter most, a direct contact is a big plus.
  const score = Math.min(100, matchedSkills.length * 10 + (hasContact ? 30 : 0) + (exp ? 10 : 0));
  return { ok: true, reason: "matched", matchedSkills, score, experienceText: exp?.text ?? null };
}
