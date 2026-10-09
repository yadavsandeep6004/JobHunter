// View collected data.
//   npm run posts            -> posts from the latest successful run
//   npm run posts -- --all   -> every post in the DB
//   npm run runs             -> run history
//   (posts hidden by `npm run rematch` have status 'filtered' and are not shown)
//   npm run export           -> CSV of every post in exports/
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXPORT_DIR } from "./config.ts";
import { openDb } from "./db.ts";

const args = new Set(process.argv.slice(2));
const db = openDb();

interface Post {
  id: number;
  author_name: string | null;
  author_headline: string | null;
  author_profile_url: string | null;
  emails: string;
  form_links: string;
  matched_skills: string;
  match_score: number;
  experience_text: string | null;
  posted_at: string | null;
  post_url: string;
  content: string;
  status: string;
  collected_at: string;
}

if (args.has("--runs")) {
  const runs = db.prepare(`SELECT id, started_at, finished_at, window_since, status, scanned, matched, inserted, error
                           FROM runs ORDER BY id DESC LIMIT 20`).all();
  console.table(runs);
} else if (args.has("--csv")) {
  const rows = db.prepare(`SELECT * FROM posts WHERE status <> 'filtered' ORDER BY posted_at DESC`).all() as unknown as Record<string, unknown>[];
  const cols = ["posted_at", "author_name", "author_headline", "emails", "form_links", "match_score",
    "matched_skills", "experience_text", "status", "post_url", "author_profile_url", "content"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  mkdirSync(EXPORT_DIR, { recursive: true });
  const file = path.join(EXPORT_DIR, `posts-${new Date().toISOString().slice(0, 10)}.csv`);
  writeFileSync(file, csv);
  console.log(`Exported ${rows.length} posts to ${file}`);
} else {
  const latest = db.prepare(`SELECT id FROM runs WHERE status = 'success' ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined;
  const posts = (args.has("--all") || !latest
    ? db.prepare(`SELECT * FROM posts WHERE status <> 'filtered' ORDER BY posted_at DESC`).all()
    : db.prepare(`SELECT * FROM posts WHERE run_id = ? AND status <> 'filtered' ORDER BY match_score DESC, posted_at DESC`).all(latest.id)) as unknown as Post[];

  if (posts.length === 0) console.log("No posts yet. Run `npm run collect`.");
  for (const p of posts) {
    console.log("─".repeat(80));
    console.log(`#${p.id}  ${p.author_name ?? "(unknown)"}  ·  score ${p.match_score}  ·  ${p.posted_at ? new Date(p.posted_at).toLocaleString() : "?"}`);
    if (p.author_headline) console.log(`    ${p.author_headline}`);
    console.log(`    emails: ${p.emails || "-"}`);
    if (p.form_links) console.log(`    forms:  ${p.form_links}`);
    console.log(`    skills: ${p.matched_skills}${p.experience_text ? `  ·  exp: ${p.experience_text}` : ""}`);
    console.log(`    post:   ${p.post_url}`);
    console.log(`    ${p.content.replace(/\s+/g, " ").slice(0, 240)}${p.content.length > 240 ? "…" : ""}`);
  }
  console.log(`\n${posts.length} post(s)${args.has("--all") ? " in DB" : " from latest run"}.`);
}
