/**
 * Job Hunter — Google Sheet side.
 *
 *  Mac (npm run collect / npm run push) ──POST──► doPost() ──► "Jobs" tab, Status = PENDING
 *  ⚡ Auto Apply → "1. Write emails (PENDING)"  : Gemini picks Frontend / Backend / Full Stack CV
 *                                                 and writes the email → Gmail draft with that CV attached
 *  You review the draft (edit it in Gmail if you like) and tick "Approve"
 *  ⚡ Auto Apply → "2. Send approved drafts"   : sends them, Status = SENT, Sent At = date
 *
 * Secrets live in Script Properties (Project Settings → Script properties), never in this code:
 *   GEMINI_API_KEY, SYNC_TOKEN, CV_FRONTEND_ID, CV_BACKEND_ID, CV_FULLSTACK_ID, SHEET_ID
 *   optional: GEMINI_MODEL (default below)
 * Run "⚙️ Setup" from the menu once — it fills these in for you.
 */

const SHEET_NAME = 'Jobs';
const DEFAULT_MODEL = 'gemini-3.6-flash'; // the model your old script used; override with Script Property GEMINI_MODEL
const MAX_EMAILS_PER_RUN = 20;      // Gemini free tier is rate limited; run the menu again for more
const GEMINI_GAP_MS = 4500;         // ~13 requests / minute
const MAX_SENDS_PER_DAY = 40;       // stay far below Gmail limits and look human
const TIME_BUDGET_MS = 5 * 60 * 1000; // Apps Script stops at 6 min

const HEADERS = [
  'Post ID', 'Posted At', 'Added On', 'Status', 'Author', 'Headline', 'Emails', 'Form Links', 'Post URL',
  'Score', 'Skills', 'Experience', 'CV', 'Role', 'Company', 'To', 'Subject', 'Email Body', 'Draft ID',
  'Approve', 'Sent At', 'Notes', 'Content',
];

const CV_FILES = {
  frontend: { prop: 'CV_FRONTEND_ID', name: 'Sandeep_Yadav_Frontend_Developer_CV.pdf' },
  backend: { prop: 'CV_BACKEND_ID', name: 'Sandeep_Yadav_Backend_Developer_CV.pdf' },
  fullstack: { prop: 'CV_FULLSTACK_ID', name: 'Sandeep_Yadav_Full_Stack_Developer_CV.pdf' },
};

const PROFILE = `
Name: Sandeep Yadav
Phone: +91-XXXXXXXXXX | Email: you@example.com | LinkedIn: https://www.linkedin.com/in/sandeepyadavm/
Location: Indore, India
Experience: 4+ years (incl. internship) — Software Development Engineer at Primathon, Jan 2022 – present.
Frontend: React.js, Next.js, JavaScript, TypeScript, Redux, Tailwind CSS, SCSS, responsive UI, performance
  optimisation (memoisation, lazy loading), reusable component architecture, German localisation.
Backend: Node.js, NestJS, Express.js, REST APIs, JWT auth, MongoDB, MySQL, PostgreSQL, TypeORM, cron jobs,
  third-party integrations (Shopify, GoKwik, Cal.com, email/SMS).
Tools: Git, Docker, Postman, Appsmith. AI-assisted development (Claude, Cursor).
Projects:
- Wandel candidate management platform (NestJS, MongoDB, Next.js, TypeScript, Cal.com scheduling, analytics dashboards).
- Open Store multi-merchant e-commerce (React, Next.js, Redux, Shopify) — reusable widgets across merchants.
- Plixkids e-commerce (Next.js, Tailwind, GoKwik login/checkout, cart, coupons).
- Inventory & Property management systems (Node.js/NestJS, MongoDB/MySQL, pagination, cron workers).
Education: B.Tech CSE, AKTU (2018–2022).
`;

// ───────────────────────────── menu ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Auto Apply')
    .addItem('1. Write emails (PENDING → Gmail drafts)', 'writeEmails')
    .addItem('2. Send approved drafts', 'sendApproved')
    .addSeparator()
    .addItem('Approve all drafted', 'approveAllDrafted')
    .addItem('Retry errored rows', 'retryErrors')
    .addItem('⚙️ Setup', 'setup')
    .addToUi();
}

// ───────────────────────────── setup ─────────────────────────────

function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('SHEET_ID', ss.getId());
  getSheet_();

  if (!props.getProperty('SYNC_TOKEN')) props.setProperty('SYNC_TOKEN', Utilities.getUuid());

  const ask = (prop, question, parse) => {
    const current = props.getProperty(prop);
    const res = ui.prompt('Setup', `${question}${current ? '\n\n(Already set — leave empty to keep it.)' : ''}`, ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return false;
    const value = res.getResponseText().trim();
    if (value) props.setProperty(prop, parse ? parse(value) : value);
    return true;
  };
  const driveId = (v) => (v.match(/[-\w]{25,}/) || [v])[0];

  if (!ask('GEMINI_API_KEY', 'Paste your Gemini API key (from aistudio.google.com/apikey):')) return;
  if (!ask('CV_FRONTEND_ID', 'Google Drive link of your FRONTEND CV (PDF):', driveId)) return;
  if (!ask('CV_BACKEND_ID', 'Google Drive link of your BACKEND CV (PDF):', driveId)) return;
  if (!ask('CV_FULLSTACK_ID', 'Google Drive link of your FULL STACK CV (PDF):', driveId)) return;

  // verify the CV files are readable
  const problems = Object.keys(CV_FILES).filter((k) => {
    try { DriveApp.getFileById(props.getProperty(CV_FILES[k].prop)); return false; } catch (e) { return true; }
  });

  ui.alert('Setup done',
    (problems.length ? `⚠️ Could not open the ${problems.join(', ')} CV — check the Drive link.\n\n` : '✓ CVs found.\n\n') +
    'Put this in job-hunter/.env on your Mac:\n\n' +
    `SYNC_TOKEN=${props.getProperty('SYNC_TOKEN')}\n` +
    'APPS_SCRIPT_URL=<the Web app URL from Deploy → New deployment>',
    ui.ButtonSet.OK);
}

// ───────────────────────────── receive rows from the Mac ─────────────────────────────

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!token) return json_({ ok: false, error: 'SYNC_TOKEN is not set in THIS Apps Script project — deploy from the project where you ran ⚙️ Setup, or add SYNC_TOKEN + SHEET_ID in Project Settings → Script properties' });
    if (body.token !== token) return json_({ ok: false, error: 'bad token — SYNC_TOKEN in .env does not match Script properties → SYNC_TOKEN' });

    const sheet = getSheet_();
    const col = colMap_(sheet);
    const existing = new Set(
      sheet.getLastRow() > 1
        ? sheet.getRange(2, col['Post ID'], sheet.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
        : [],
    );

    const now = new Date();
    const out = [];
    let skipped = 0;
    for (const p of body.rows || []) {
      if (!p.postId || existing.has(p.postId)) { skipped++; continue; }
      existing.add(p.postId);
      const status = p.emails ? 'PENDING' : p.formLinks ? 'FORM' : 'NO_EMAIL';
      const row = new Array(HEADERS.length).fill('');
      const set = (name, v) => { row[col[name] - 1] = v == null ? '' : v; };
      set('Post ID', p.postId);
      set('Posted At', p.postedAt ? new Date(p.postedAt) : '');
      set('Added On', now);
      set('Status', status);
      set('Author', p.author);
      set('Headline', p.headline);
      set('Emails', p.emails);
      set('Form Links', p.formLinks);
      set('Post URL', p.postUrl);
      set('Score', p.score);
      set('Skills', p.skills);
      set('Experience', p.experience);
      set('Approve', false);
      set('Content', String(p.content || '').slice(0, 45000));
      out.push(row);
    }
    if (out.length) {
      const start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, out.length, HEADERS.length).setValues(out);
      sheet.getRange(start, col['Approve'], out.length, 1).insertCheckboxes();
    }
    return json_({ ok: true, added: out.length, skipped });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── 1. write emails ─────────────────────────────

function writeEmails() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_API_KEY')) return alert_('Run ⚡ Auto Apply → ⚙️ Setup first.');

  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const cvCache = {};

  // never email the same address twice
  const contacted = new Set();
  for (let r = 1; r < data.length; r++) {
    const st = data[r][col['Status'] - 1];
    if (st === 'DRAFTED' || st === 'SENT') contacted.add(String(data[r][col['To'] - 1]).toLowerCase());
  }

  let done = 0, skipped = 0, failed = 0, stoppedEarly = '';
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] !== 'PENDING') continue;
    if (done + skipped >= MAX_EMAILS_PER_RUN) { stoppedEarly = `Stopped after ${MAX_EMAILS_PER_RUN} posts (rate limit).`; break; }
    if (Date.now() - started > TIME_BUDGET_MS) { stoppedEarly = 'Stopped before the 6-minute limit.'; break; }

    const rowNum = r + 1;
    const get = (name) => data[r][col[name] - 1];
    const set = (name, v) => sheet.getRange(rowNum, col[name]).setValue(v);

    const emails = String(get('Emails')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const fresh = emails.filter((em) => !contacted.has(em));
    if (!fresh.length) {
      set('Status', 'DUPLICATE'); set('Notes', 'Already emailed this address.'); skipped++; continue;
    }

    let ai;
    try {
      ai = callGemini_(get('Content'), get('Author'), get('Headline'), fresh);
    } catch (err) {
      const msg = String(err.message || err);
      // busy / rate-limited on every model: leave the row PENDING for the next run
      if (err.busy) { stoppedEarly = 'Gemini is busy right now (' + msg.slice(0, 160) + ').\nRows stay PENDING — run "1. Write emails" again in a few minutes.'; break; }
      set('Status', 'ERROR'); set('Notes', msg.slice(0, 300)); failed++; continue;
    }

    if (!ai.relevant) {
      set('Status', 'SKIPPED'); set('Notes', 'AI: ' + (ai.reason || 'not a fit')); skipped++;
      Utilities.sleep(GEMINI_GAP_MS); continue;
    }

    const cvType = CV_FILES[ai.cv_type] ? ai.cv_type : 'fullstack';
    const to = fresh.includes(String(ai.to_email).toLowerCase()) ? String(ai.to_email).toLowerCase() : fresh[0];
    try {
      const cv = cvCache[cvType] || (cvCache[cvType] = cvBlob_(cvType));
      const draft = GmailApp.createDraft(to, ai.subject, ai.body, { attachments: [cv], name: 'Sandeep Yadav' });
      set('CV', cvType);
      set('Role', ai.role || '');
      set('Company', ai.company || '');
      set('To', to);
      set('Subject', ai.subject);
      set('Email Body', ai.body);
      set('Draft ID', draft.getId());
      set('Status', 'DRAFTED');
      set('Notes', (ai.reason || '') + ' [' + ai._model + ']');
      contacted.add(to);
      done++;
    } catch (err) {
      set('Status', 'ERROR'); set('Notes', String(err.message || err).slice(0, 300)); failed++;
    }
    SpreadsheetApp.flush();
    Utilities.sleep(GEMINI_GAP_MS);
  }

  alert_(`Drafts created: ${done}\nSkipped: ${skipped}\nErrors: ${failed}` +
    (stoppedEarly ? `\n\n${stoppedEarly}` : '') +
    '\n\nCheck Gmail → Drafts, tick "Approve" for the good ones, then run "2. Send approved drafts".');
}

function callGemini_(content, author, headline, emails) {

  const prompt = `You help a software developer apply to jobs found in LinkedIn hiring posts.

CANDIDATE PROFILE (the only facts you may use about the candidate):
${PROFILE}

LINKEDIN POST
Author: ${author}
Author headline: ${headline}
Emails found in the post: ${emails.join(', ')}
Post text:
"""
${String(content).slice(0, 6000)}
"""

TASKS
1. relevant: true only if the post is a real job opening that fits this candidate (JavaScript/TypeScript web
   stack, roughly 2–6 years experience, India or remote). Otherwise false with a short reason.
2. cv_type: which CV fits best —
   "frontend"  = mainly React/Next.js/UI work,
   "backend"   = mainly Node.js/NestJS/APIs/databases,
   "fullstack" = both, or MERN/full stack, or unclear.
3. to_email: the one address from the list above to send the application to (prefer HR/careers/the recruiter).
4. role and company from the post ("" if not stated — do not guess).
5. subject: "Application for <role> – Sandeep Yadav (4+ yrs <2–3 key skills>)".
6. body: plain-text email, 110–170 words:
   - Greeting: "Hi <first name>," if the email clearly belongs to the post author, else "Hi Hiring Team,".
   - One line on the role you are applying for (mention the company if known).
   - 2–3 short lines matching the post's requirements to concrete experience from the profile.
   - Say the CV is attached and you are happy to discuss.
   - Sign off: "Regards,\\nSandeep Yadav\\n+91-XXXXXXXXXX\\nhttps://www.linkedin.com/in/sandeepyadavm/"
   - No placeholders like [Company], no invented facts (notice period, CTC, degrees, skills not in the profile).
7. reason: one short line explaining your choices.

Return JSON only:
{"relevant": true, "reason": "", "cv_type": "frontend|backend|fullstack", "to_email": "", "role": "", "company": "", "subject": "", "body": ""}`;

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const tried = [];

  // Each model has its own capacity + free quota: on 503 retry once, then move to the next model.
  for (const model of candidateModels_()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
        payload, muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      const text = res.getContentText();
      if (code === 200) {
        const out = JSON.parse(text).candidates[0].content.parts[0].text
          .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const ai = JSON.parse(out);
        if (ai.relevant && (!ai.subject || !ai.body)) throw new Error('Gemini returned an empty subject/body');
        ai._model = model;
        CacheService.getScriptCache().put('gemini_last_good', model, 600); // stick with it for 10 min
        return ai;
      }
      tried.push(`${model} ${code}`);
      if (code === 500 || code === 503 || code === 504) { if (attempt === 0) Utilities.sleep(4000); continue; }
      if (code === 429 || code === 404) break; // quota used up / model not available → next model
      throw new Error(`Gemini ${code}: ${text.slice(0, 250)}`); // bad key, bad request: a real error
    }
  }
  const err = new Error('all models busy: ' + tried.join(', '));
  err.busy = true;
  throw err;
}

/**
 * Models to try, in order: GEMINI_MODEL (or DEFAULT_MODEL) first, then the other text "flash" models
 * this API key can use, newest first. The list comes from the API itself (cached 6h), so no names are guessed.
 */
function candidateModels_() {
  const props = PropertiesService.getScriptProperties();
  const preferred = props.getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  const cache = CacheService.getScriptCache();
  let available = JSON.parse(cache.get('gemini_models') || 'null');
  if (!available) {
    available = [];
    try {
      const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': props.getProperty('GEMINI_API_KEY') }, muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) {
        const version = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
        const rank = (n) => version(n) * 10 - (/lite/.test(n) ? 1 : 0) - (/preview|exp/.test(n) ? 5 : 0);
        available = (JSON.parse(res.getContentText()).models || [])
          .filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0)
          .map((m) => m.name.replace(/^models\//, ''))
          .filter((n) => /^gemini-.*flash/.test(n) && !/image|tts|audio|live|embed|vision|thinking/.test(n))
          .sort((a, b) => rank(b) - rank(a));
        cache.put('gemini_models', JSON.stringify(available), 6 * 3600);
      }
    } catch (e) { /* fall back to the preferred model only */ }
  }
  const lastGood = cache.get('gemini_last_good');
  const order = (lastGood ? [lastGood] : []).concat([preferred], available);
  return order.filter((m, i) => order.indexOf(m) === i).slice(0, 5);
}

/** Puts rows that failed (and were never sent) back to PENDING. */
function retryErrors() {
  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  let n = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] === 'ERROR' && !data[r][col['Sent At'] - 1]) {
      sheet.getRange(r + 1, col['Status']).setValue('PENDING');
      sheet.getRange(r + 1, col['Notes']).setValue('');
      n++;
    }
  }
  alert_(`${n} row(s) set back to PENDING. Now run "1. Write emails".`);
}

function cvBlob_(type) {
  const id = PropertiesService.getScriptProperties().getProperty(CV_FILES[type].prop);
  if (!id) throw new Error(`No ${type} CV set — run ⚙️ Setup.`);
  return DriveApp.getFileById(id).getBlob().setName(CV_FILES[type].name);
}

// ───────────────────────────── 2. send approved ─────────────────────────────

function sendApproved() {
  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  let sentToday = 0;
  for (let r = 1; r < data.length; r++) {
    const at = data[r][col['Sent At'] - 1];
    if (at instanceof Date && Utilities.formatDate(at, Session.getScriptTimeZone(), 'yyyy-MM-dd') === today) sentToday++;
  }

  let sent = 0, failed = 0, capped = false;
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] !== 'DRAFTED' || data[r][col['Approve'] - 1] !== true) continue;
    if (sentToday >= MAX_SENDS_PER_DAY || MailApp.getRemainingDailyQuota() < 5) { capped = true; break; }
    const rowNum = r + 1;
    try {
      GmailApp.getDraft(data[r][col['Draft ID'] - 1]).send();
      sheet.getRange(rowNum, col['Status']).setValue('SENT');
      sheet.getRange(rowNum, col['Sent At']).setValue(new Date());
      sent++; sentToday++;
    } catch (err) {
      // draft deleted in Gmail, etc.
      sheet.getRange(rowNum, col['Status']).setValue('ERROR');
      sheet.getRange(rowNum, col['Notes']).setValue('Send failed: ' + String(err.message || err).slice(0, 250));
      failed++;
    }
    Utilities.sleep(1500 + Math.random() * 2000);
  }
  alert_(`Sent: ${sent}\nFailed: ${failed}` + (capped ? `\n\nDaily cap of ${MAX_SENDS_PER_DAY} reached — the rest go tomorrow.` : ''));
}

function approveAllDrafted() {
  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  let n = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] === 'DRAFTED' && data[r][col['Approve'] - 1] !== true) {
      sheet.getRange(r + 1, col['Approve']).setValue(true); n++;
    }
  }
  alert_(`Approved ${n} draft(s). Review them in Gmail before running "2. Send approved drafts".`);
}

// ───────────────────────────── helpers ─────────────────────────────

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:C').setNumberFormat('dd-mmm-yyyy hh:mm');
    sheet.getRange('U:U').setNumberFormat('dd-mmm-yyyy hh:mm');
    sheet.getRange('A:W').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }
  return sheet;
}

function colMap_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  header.forEach((h, i) => { map[String(h).trim()] = i + 1; });
  const missing = HEADERS.filter((h) => !map[h]);
  if (missing.length) throw new Error(`"${SHEET_NAME}" sheet is missing columns: ${missing.join(', ')}`);
  return map;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
