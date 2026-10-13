/**
 * Job Hunter — Google Sheet side.
 *
 *  LinkedIn: you click 📩 Send on a post (Chrome extension) → doPost "capture" → row in "Jobs":
 *            NEW (has an email) / FORM / NO_EMAIL
 *  Mac:      npm run process → "pending" (NEW rows) → ChatGPT writes {cv, to_email, subject, message}
 *            → "result" → Gmail draft with the matching CV attached (Status DRAFTED)
 *  You:      open Gmail → Drafts, read each email and send the good ones yourself
 *
 * Script Properties (Project Settings → Script properties), filled by "⚙️ Setup":
 *   SYNC_TOKEN, SHEET_ID, CV_FRONTEND_ID, CV_BACKEND_ID, CV_FULLSTACK_ID
 */

const MY_NAME = 'Your Name';  // ← your name: sender name + CV file names in the emails
const SHEET_NAME = 'Jobs';

const HEADERS = [
  'Post ID', 'Posted At', 'Added On', 'Status', 'Author', 'Headline', 'Emails', 'Form Links', 'Post URL',
  'CV', 'Role', 'Company', 'To', 'Subject', 'Email Body', 'Draft ID', 'Notes', 'Content',
];

const FILE_NAME = MY_NAME.replace(/\s+/g, '_');
const CV_FILES = {
  frontend: { prop: 'CV_FRONTEND_ID', name: `${FILE_NAME}_Frontend_Developer_CV.pdf` },
  backend: { prop: 'CV_BACKEND_ID', name: `${FILE_NAME}_Backend_Developer_CV.pdf` },
  fullstack: { prop: 'CV_FULLSTACK_ID', name: `${FILE_NAME}_Full_Stack_Developer_CV.pdf` },
};

// ───────────────────────────── menu ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Auto Apply')
    .addItem('Create missing drafts (READY rows)', 'createMissingDrafts')
    .addItem('⚙️ Setup', 'setup')
    .addToUi();
}

// ───────────────────────────── setup ─────────────────────────────

function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  getSheet_();
  if (!props.getProperty('SYNC_TOKEN')) props.setProperty('SYNC_TOKEN', Utilities.getUuid());

  const driveId = (v) => (v.match(/[-\w]{25,}/) || [v])[0];
  for (const type of Object.keys(CV_FILES)) {
    const prop = CV_FILES[type].prop;
    const res = ui.prompt('Setup', `Google Drive link of your ${type.toUpperCase()} CV (PDF):` +
      (props.getProperty(prop) ? '\n\n(Already set — leave empty to keep it.)' : ''), ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const v = res.getResponseText().trim();
    if (v) props.setProperty(prop, driveId(v));
  }

  const problems = Object.keys(CV_FILES).filter((k) => {
    try { DriveApp.getFileById(props.getProperty(CV_FILES[k].prop)); return false; } catch (e) { return true; }
  });
  ui.alert('Setup done',
    (problems.length ? `⚠️ Could not open the ${problems.join(', ')} CV — check the Drive link.\n\n` : '✓ CVs found.\n\n') +
    `Sync token (for .env and the Chrome extension):\n${props.getProperty('SYNC_TOKEN')}\n\n` +
    'Web app URL: Deploy → Manage deployments',
    ui.ButtonSet.OK);
}

// ───────────────────────────── web app (extension + Mac) ─────────────────────────────

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!token) return json_({ ok: false, error: 'SYNC_TOKEN is not set in THIS Apps Script project — run ⚙️ Setup here' });
    if (body.token !== token) return json_({ ok: false, error: 'bad token — it must match Script properties → SYNC_TOKEN' });

    const sheet = getSheet_();
    const col = colMap_(sheet);
    if (body.action === 'ping') return json_({ ok: true });
    if (body.action === 'capture') return json_(capture_(sheet, col, body.rows || []));
    if (body.action === 'pending') return json_(pending_(sheet, col));
    if (body.action === 'result') return json_(result_(sheet, col, body.postId, body.ai));
    return json_({ ok: false, error: `unknown action "${body.action}" — update the extension / Mac code` });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Posts sent from the 📩 button. Same Post ID → ignored. Same job text as a post already in the sheet
 * (a repost, another recruiter, a different email) → saved as DUPLICATE so it never gets a second email.
 */
function capture_(sheet, col, rows) {
  const data = sheet.getDataRange().getValues();
  const ids = new Set(data.slice(1).map((r) => String(r[col['Post ID'] - 1])));
  const known = data.slice(1).map((r, i) => ({ row: i + 2, author: r[col['Author'] - 1], jd: jdShingles_(r[col['Content'] - 1]) }));
  const width = sheet.getLastColumn();
  let added = 0, status = '', note = '';
  for (const p of rows) {
    if (!p.postId || ids.has(p.postId)) continue;
    ids.add(p.postId);
    const jd = jdShingles_(p.content);
    const same = known.find((k) => sameJob_(jd, k.jd));
    status = same ? 'DUPLICATE' : p.emails ? 'NEW' : p.formLinks ? 'FORM' : 'NO_EMAIL';
    note = same ? `Same job as row ${same.row} (${same.author})` : '';

    const row = new Array(width).fill('');
    const set = (name, v) => { row[col[name] - 1] = v == null ? '' : v; };
    set('Post ID', p.postId);
    set('Posted At', p.postedAt ? new Date(p.postedAt) : '');
    set('Added On', new Date());
    set('Status', status);
    set('Author', p.author);
    set('Headline', p.headline);
    set('Emails', p.emails);
    set('Form Links', p.formLinks);
    set('Post URL', p.postUrl);
    set('Notes', note);
    set('Content', String(p.content || '').slice(0, 45000));
    const rowNum = sheet.getLastRow() + 1;
    sheet.getRange(rowNum, 1, 1, width).setValues([row]);
    known.push({ row: rowNum, author: p.author, jd });
    added++;
  }
  return { ok: true, added, status, note };
}

/** The job text as a set of 3-word phrases, ignoring emails, links, hashtags, emoji and punctuation. */
function jdShingles_(text) {
  const words = String(text || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .replace(/#[\w-]+/g, ' ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ').filter((w) => w.length > 1);
  const set = new Set();
  for (let i = 0; i + 2 < words.length; i++) set.add(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
  return set;
}

/** Same job if ≥ 80% of the shorter post's phrases appear in the other (reposts often add or drop a line). */
function sameJob_(a, b) {
  if (a.size < 10 || b.size < 10) return false; // too short to judge
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const x of small) if (big.has(x)) shared++;
  return shared / small.size >= 0.8;
}

/** NEW rows waiting for ChatGPT. */
function pending_(sheet, col) {
  const data = sheet.getDataRange().getValues();
  const posts = [];
  for (let r = 1; r < data.length; r++) {
    const get = (name) => data[r][col[name] - 1];
    if (get('Status') !== 'NEW') continue;
    posts.push({
      postId: String(get('Post ID')),
      author: String(get('Author')),
      headline: String(get('Headline')),
      emails: String(get('Emails')).split(',').map((s) => s.trim()).filter(Boolean),
      content: String(get('Content')),
    });
  }
  return { ok: true, posts };
}

/** ChatGPT's answer for one post → SKIPPED / DUPLICATE / DRAFTED (Gmail draft with the right CV) / READY. */
function result_(sheet, col, postId, ai) {
  const data = sheet.getDataRange().getValues();
  const r = data.findIndex((row, i) => i > 0 && String(row[col['Post ID'] - 1]) === String(postId));
  if (r < 0) return { ok: false, error: `post ${postId} not found in the sheet` };
  // already handled (e.g. the Mac retried after a flaky answer) → never create a second draft
  const current = data[r][col['Status'] - 1];
  if (current !== 'NEW') return { ok: true, status: current };
  const rowNum = r + 1;
  const set = (name, v) => sheet.getRange(rowNum, col[name]).setValue(v == null ? '' : v);

  set('CV', ai.cv); set('Role', ai.role); set('Company', ai.company); set('To', ai.toEmail);
  set('Subject', ai.subject); set('Email Body', ai.message); set('Notes', ai.reason);

  let status;
  const contacted = new Set();
  for (let i = 1; i < data.length; i++) {
    const st = data[i][col['Status'] - 1];
    // (SENT: rows from the older version that sent from the sheet)
    if (i !== r && (st === 'DRAFTED' || st === 'SENT' || st === 'READY')) contacted.add(String(data[i][col['To'] - 1]).toLowerCase());
  }
  // same company + role already drafted / sent (ChatGPT's reading of the post)
  const key = (company, role) => company && role ? (String(company) + '|' + String(role)).toLowerCase().replace(/[^a-z0-9|]+/g, '') : '';
  const thisJob = key(ai.company, ai.role);
  const sameJobRow = thisJob && data.findIndex((row, i) => i > 0 && i !== r &&
    ['DRAFTED', 'SENT', 'READY'].includes(row[col['Status'] - 1]) && key(row[col['Company'] - 1], row[col['Role'] - 1]) === thisJob);

  if (!ai.relevant) {
    status = 'SKIPPED';
  } else if (contacted.has(String(ai.toEmail).toLowerCase())) {
    status = 'DUPLICATE';
    set('Notes', 'Already emailed ' + ai.toEmail);
  } else if (sameJobRow > 0) {
    status = 'DUPLICATE';
    set('Notes', `Same job (${ai.role} at ${ai.company}) as row ${sameJobRow + 1}`);
  } else {
    try {
      set('Draft ID', createDraft_(ai.toEmail, ai.subject, ai.message, ai.cv).getId());
      status = 'DRAFTED';
    } catch (err) {
      status = 'READY'; // email written, draft failed → "Create missing drafts"
      set('Notes', 'Draft failed: ' + String(err.message || err).slice(0, 200));
    }
  }
  set('Status', status);
  return { ok: true, status };
}

function createDraft_(to, subject, message, cvType, cache) {
  const type = CV_FILES[cvType] ? cvType : 'fullstack';
  let cv = cache && cache[type];
  if (!cv) {
    const id = PropertiesService.getScriptProperties().getProperty(CV_FILES[type].prop);
    if (!id) throw new Error(`No ${type} CV set — run ⚙️ Setup`);
    cv = DriveApp.getFileById(id).getBlob().setName(CV_FILES[type].name);
    if (cache) cache[type] = cv;
  }
  return GmailApp.createDraft(to, subject, message, { attachments: [cv], name: MY_NAME });
}

// ───────────────────────────── menu actions ─────────────────────────────

/** Rows where the email was written but the draft failed (Status READY). */
function createMissingDrafts() {
  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const cache = {};
  let n = 0, failed = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] !== 'READY') continue;
    const get = (name) => data[r][col[name] - 1];
    try {
      const draft = createDraft_(get('To'), get('Subject'), get('Email Body'), get('CV'), cache);
      sheet.getRange(r + 1, col['Draft ID']).setValue(draft.getId());
      sheet.getRange(r + 1, col['Status']).setValue('DRAFTED');
      sheet.getRange(r + 1, col['Notes']).setValue('');
      n++;
    } catch (err) {
      sheet.getRange(r + 1, col['Notes']).setValue('Draft failed: ' + String(err.message || err).slice(0, 200));
      failed++;
    }
  }
  alert_(`Drafts created: ${n}` + (failed ? `\nFailed: ${failed} (see Notes)` : ''));
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
    const col = colMap_(sheet);
    for (const name of ['Posted At', 'Added On']) {
      sheet.getRange(2, col[name], sheet.getMaxRows() - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
    }
    sheet.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }
  return sheet;
}

/** Column number by header name. Extra columns (e.g. from older versions) are fine. */
function colMap_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  header.forEach((h, i) => { map[String(h).trim()] = i + 1; });
  const missing = HEADERS.filter((h) => !map[h]);
  if (missing.length) throw new Error(`"${SHEET_NAME}" sheet is missing columns: ${missing.join(', ')}`);
  return map;
}

function columnValues_(sheet, colNum) {
  const n = sheet.getLastRow() - 1;
  return n > 0 ? sheet.getRange(2, colNum, n, 1).getValues().map((r) => String(r[0])) : [];
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
