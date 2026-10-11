import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config.ts";
import { extractJson } from "./client.ts";

export type CvType = "frontend" | "backend" | "fullstack";

export interface PostForAi {
  author: string | null;
  headline: string | null;
  emails: string[];
  content: string;
}

export interface AiReply {
  relevant: boolean;
  reason: string;
  cv: CvType;
  toEmail: string;
  role: string;
  company: string;
  subject: string;
  message: string;
}

const profile = () => readFileSync(path.join(ROOT, "config", "profile.md"), "utf8").trim();

/** One self-contained prompt per post, so starting a new chat never loses context. */
export function buildPrompt(post: PostForAi): string {
  return `You are my job-application assistant. Read the LinkedIn hiring post and my profile, then write the application email I will send to the recruiter.

## My profile — the ONLY facts you may use about me
${profile()}

## LinkedIn post
Author: ${post.author ?? "unknown"}
Author headline: ${post.headline ?? "-"}
Email addresses in the post: ${post.emails.join(", ")}
---
${post.content.slice(0, 6000)}
---

## What to decide
1. relevant — true only if this is a real opening that matches "Looking for" in my profile (skills, experience, location). Otherwise false.
   Also false if it looks fake or risky: asks for a fee/deposit, odd or misspelled email domains, "earn $$$ from home", no real company.
2. cv — which of my CVs to attach:
   • "frontend"  → the role is mainly UI / frontend work
   • "backend"   → mainly APIs / server / databases
   • "fullstack" → both sides, or unclear
3. to_email — exactly one address from the list above to send to (prefer the recruiter / HR / careers address).
4. role, company, location — as written in the post; "" if not stated. Never guess.

## How to write the email
• subject: "Application for <role> – <my name> (<my years of experience>)"
• message: plain text, SHORT — 50–80 words before the sign-off, no filler or buzzwords:
  – "Hi <first name>," when the address clearly belongs to the post author, otherwise "Hi Hiring Team,"
  – 1 line: the role I'm applying for (and the company if known)
  – 1–2 lines: my years of experience + the 3–4 skills from the post I really have
  – 1 line: CV attached, happy to talk
  – end with "Regards," then my name, phone and LinkedIn from my profile, each on its own line
• Never invent anything (notice period, CTC, degrees, skills, companies not in my profile) and don't offer
  anything that isn't in it (GitHub, portfolio, references). No [placeholders].

## Output
Reply with ONLY this JSON inside one \`\`\`json code block — no text before or after:
\`\`\`json
{
  "relevant": true,
  "reason": "one short line explaining the decision",
  "cv": "frontend | backend | fullstack",
  "to_email": "",
  "role": "",
  "company": "",
  "location": "",
  "subject": "",
  "message": ""
}
\`\`\``;
}

/** Parses + sanity-checks ChatGPT's JSON; to_email must be one of the post's emails. */
export function parseReply(reply: string, emails: string[]): AiReply {
  const j = extractJson<Record<string, unknown>>(reply);
  const str = (k: string) => (typeof j[k] === "string" ? (j[k] as string).trim() : "");
  const cvRaw = str("cv").toLowerCase().replace(/[\s_-]/g, "");
  const cv: CvType = cvRaw === "frontend" || cvRaw === "backend" ? cvRaw : "fullstack";
  const wanted = str("to_email").toLowerCase();
  const relevant = j.relevant === true || j.relevant === "true";
  const out: AiReply = {
    relevant,
    reason: str("reason"),
    cv,
    toEmail: emails.includes(wanted) ? wanted : emails[0] ?? "",
    role: str("role"),
    company: str("company"),
    subject: str("subject"),
    message: str("message").replace(/\\n/g, "\n"),
  };
  if (relevant && (!out.subject || !out.message)) throw new Error("ChatGPT reply is missing subject/message");
  return out;
}
