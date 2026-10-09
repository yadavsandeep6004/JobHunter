// Re-applies the current config/search.json filters to posts already in the DB.
// Posts that no longer match get status "filtered" (hidden from `npm run posts`, not deleted).
// Posts that match again are restored to "new". Already-acted posts (emailed etc.) are left alone.
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { matchPost } from "./match.ts";

interface Row {
  id: number;
  author_name: string | null;
  author_headline: string | null;
  content: string;
  emails: string;
  form_links: string;
  status: string;
}

const cfg = loadConfig();
const db = openDb();
const rows = db
  .prepare(`SELECT id, author_name, author_headline, content, emails, form_links, status
            FROM posts WHERE status IN ('new', 'filtered')`)
  .all() as unknown as Row[];

const update = db.prepare(`UPDATE posts SET status = ?, matched_skills = ?, match_score = ? WHERE id = ?`);
const reasons = new Map<string, number>();
let kept = 0;
let filtered = 0;

for (const r of rows) {
  const m = matchPost(
    r.content,
    cfg,
    { emails: r.emails ? r.emails.split(",") : [], formLinks: r.form_links ? r.form_links.split(",") : [] },
    `${r.author_name ?? ""}\n${r.author_headline ?? ""}`,
  );
  if (m.ok) {
    kept++;
    update.run("new", m.matchedSkills.join(","), m.score, r.id);
  } else {
    filtered++;
    const key = m.reason.replace(/: ".*"$/, "");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    update.run("filtered", m.matchedSkills.join(","), 0, r.id);
  }
}

console.log(`Re-checked ${rows.length} posts: ${kept} match, ${filtered} filtered out.`);
for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${reason}`);
