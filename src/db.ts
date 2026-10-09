import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { DATA_DIR, DB_PATH } from "./config.ts";

export interface PostRow {
  post_urn: string;
  content_hash: string;
  post_url: string;
  author_name: string | null;
  author_headline: string | null;
  author_profile_url: string | null;
  content: string;
  emails: string[];
  form_links: string[];
  matched_skills: string[];
  match_score: number;
  experience_text: string | null;
  query: string;
  posted_at: string | null;
  posted_at_source: "id" | "relative" | null;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  window_since: string;
  status: string;
}

export function openDb(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      window_since  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'running',  -- running | success | failed
      scanned       INTEGER NOT NULL DEFAULT 0,
      matched       INTEGER NOT NULL DEFAULT 0,
      inserted      INTEGER NOT NULL DEFAULT 0,
      error         TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      post_urn            TEXT NOT NULL UNIQUE,      -- urn:li:activity:… or hash:… when unknown
      content_hash        TEXT NOT NULL UNIQUE,      -- author + text, catches the same post seen twice
      post_url            TEXT NOT NULL,
      author_name         TEXT,
      author_headline     TEXT,
      author_profile_url  TEXT,
      content             TEXT NOT NULL,
      emails              TEXT NOT NULL DEFAULT '',   -- comma separated
      form_links          TEXT NOT NULL DEFAULT '',   -- comma separated
      matched_skills      TEXT NOT NULL DEFAULT '',
      match_score         INTEGER NOT NULL DEFAULT 0,
      experience_text     TEXT,
      query               TEXT,
      posted_at           TEXT,
      posted_at_source    TEXT,
      collected_at        TEXT NOT NULL,
      run_id              INTEGER REFERENCES runs(id),
      status              TEXT NOT NULL DEFAULT 'new' -- new | emailed | form_filled | skipped
    );

    CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
    CREATE INDEX IF NOT EXISTS idx_posts_run ON posts(run_id);
  `);
  // migrations for DBs created by older versions
  const cols = (db.prepare(`PRAGMA table_info(posts)`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("pushed_at")) db.exec(`ALTER TABLE posts ADD COLUMN pushed_at TEXT`); // sent to Google Sheet
  return db;
}

/** The last successful run — its start time is where today's window begins. */
export function lastSuccessfulRun(db: DatabaseSync): RunRow | undefined {
  return db
    .prepare(`SELECT id, started_at, finished_at, window_since, status FROM runs
              WHERE status = 'success' ORDER BY id DESC LIMIT 1`)
    .get() as RunRow | undefined;
}

export function startRun(db: DatabaseSync, startedAt: Date, since: Date): number {
  const res = db
    .prepare(`INSERT INTO runs (started_at, window_since) VALUES (?, ?)`)
    .run(startedAt.toISOString(), since.toISOString());
  return Number(res.lastInsertRowid);
}

export function finishRun(
  db: DatabaseSync,
  runId: number,
  stats: { status: "success" | "failed"; scanned: number; matched: number; inserted: number; error?: string },
): void {
  db.prepare(
    `UPDATE runs SET finished_at = ?, status = ?, scanned = ?, matched = ?, inserted = ?, error = ? WHERE id = ?`,
  ).run(new Date().toISOString(), stats.status, stats.scanned, stats.matched, stats.inserted, stats.error ?? null, runId);
}

/** Inserts a post; returns false if it was already stored (dedupe by URN). */
export function insertPost(db: DatabaseSync, runId: number, p: PostRow): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO posts
        (post_urn, content_hash, post_url, author_name, author_headline, author_profile_url, content,
         emails, form_links, matched_skills, match_score, experience_text, query,
         posted_at, posted_at_source, collected_at, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.post_urn,
      p.content_hash,
      p.post_url,
      p.author_name,
      p.author_headline,
      p.author_profile_url,
      p.content,
      p.emails.join(","),
      p.form_links.join(","),
      p.matched_skills.join(","),
      p.match_score,
      p.experience_text,
      p.query,
      p.posted_at,
      p.posted_at_source,
      new Date().toISOString(),
      runId,
    );
  return Number(res.changes) > 0;
}

export function isKnownPost(db: DatabaseSync, contentHash: string, urn: string | null): boolean {
  return !!db
    .prepare(`SELECT 1 FROM posts WHERE content_hash = ? OR post_urn = ? LIMIT 1`)
    .get(contentHash, urn ?? "");
}
