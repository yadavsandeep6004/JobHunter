import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "./chatgpt/client.ts";
import { buildPrompt, parseReply } from "./chatgpt/prompt.ts";

test("extracts JSON from ChatGPT's copied reply", () => {
  // exactly what "Copy response" returned in the live test
  const reply = 'Cats are curious.\n\njson\n```\n{"ok": true}\n```';
  assert.deepEqual(extractJson(reply), { ok: true });
  assert.deepEqual(extractJson('```json\n{"a": "x } y", "b": {"c": 1}}\n```'), { a: "x } y", b: { c: 1 } });
  assert.throws(() => extractJson("no json here"));
});

test("parses a reply and keeps to_email inside the post's emails", () => {
  const reply = '```json\n{"relevant": true, "reason": "React role", "cv": "Front-end", "to_email": "someone@else.com",' +
    ' "role": "React Developer", "company": "Acme", "subject": "Application for React Developer", "message": "Hi Hiring Team,\\nRegards"}\n```';
  const r = parseReply(reply, ["hr@acme.in", "jobs@acme.in"]);
  assert.equal(r.cv, "frontend");
  assert.equal(r.toEmail, "hr@acme.in"); // not in the post → first post email
  assert.equal(r.message, "Hi Hiring Team,\nRegards");
});

test("unknown cv falls back to fullstack; not-relevant needs no message", () => {
  const r = parseReply('{"relevant": false, "reason": "Java role", "cv": "devops", "to_email": "hr@acme.in"}', ["hr@acme.in"]);
  assert.equal(r.relevant, false);
  assert.equal(r.cv, "fullstack");
  assert.throws(() => parseReply('{"relevant": true, "cv": "backend", "subject": ""}', ["a@b.co"]));
});

test("prompt contains the post, emails and the profile", () => {
  const p = buildPrompt({ author: "Priya", headline: "HR @ Acme", emails: ["hr@acme.in"], content: "Hiring React dev" });
  assert.match(p, /Hiring React dev/);
  assert.match(p, /hr@acme\.in/);
  assert.match(p, /Primathon/);
  assert.match(p, /```json/);
});
