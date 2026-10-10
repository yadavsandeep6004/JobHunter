/**
 * Job Hunter — Google Sheet side (ChatGPT flow).
 *
 *  Mac: npm run collect → LinkedIn posts → ChatGPT writes {cv, to_email, subject, message}
 *       → POST to doPost() here → row in "Jobs" + Gmail draft with the matching CV attached (Status DRAFTED)
 *  You: check Gmail → Drafts, tick "Approve" in the sheet
 *  ⚡ Auto Apply → "Send approved drafts" → Status SENT + Sent At date
 *
 * Script Properties (Project Settings → Script properties), filled by "⚙️ Setup":
 *   SYNC_TOKEN, SHEET_ID, CV_FRONTEND_ID, CV_BACKEND_ID, CV_FULLSTACK_ID
 */

const MY_NAME = 'Sandeep Yadav';  // sender name + CV file names in the emails
const SHEET_NAME = 'Jobs';
const MAX_SENDS_PER_DAY = 40; // stay far below Gmail limits and look human

const HEADERS = [
  'Post ID', 'Posted At', 'Added On', 'Status', 'Author', 'Headline', 'Emails', 'Form Links', 'Post URL',
  'Score', 'Skills', 'Experience', 'CV', 'Role', 'Company', 'To', 'Subject', 'Email Body', 'Draft ID',
  'Approve', 'Sent At', 'Notes', 'Content',
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
    .addItem('Send approved drafts', 'sendApproved')
    .addItem('Approve all drafted', 'approveAllDrafted')
    .addSeparator()
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
    'job-hunter/.env on your Mac needs:\n\n' +
    `SYNC_TOKEN=${props.getProperty('SYNC_TOKEN')}\n` +
    'APPS_SCRIPT_URL=<Web app URL from Deploy → Manage deployments>',
    ui.ButtonSet.OK);
}

// ───────────────────────────── receive rows from the Mac ─────────────────────────────

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!token) return json_({ ok: false, error: 'SYNC_TOKEN is not set in THIS Apps Script project — run ⚙️ Setup here' });
    if (body.token !== token) return json_({ ok: false, error: 'bad token — SYNC_TOKEN in .env does not match Script properties → SYNC_TOKEN' });

    const sheet = getSheet_();
    const col = colMap_(sheet);
    const data = sheet.getDataRange().getValues();

    // {action: "ids"} → Post IDs already in the sheet, so the Mac doesn't ask ChatGPT about them again
    if (body.action === 'ids') {
      return json_({ ok: true, ids: data.slice(1).map((r) => String(r[col['Post ID'] - 1])).filter(Boolean) });
    }

    const existing = new Set();
    const contacted = new Set(); // never email the same address twice
    for (let r = 1; r < data.length; r++) {
      existing.add(String(data[r][col['Post ID'] - 1]));
      const st = data[r][col['Status'] - 1];
      if (st === 'DRAFTED' || st === 'SENT' || st === 'READY') contacted.add(String(data[r][col['To'] - 1]).toLowerCase());
    }

    const now = new Date();
    const cvCache = {};
    let added = 0, skipped = 0, drafted = 0;
    for (const p of body.rows || []) {
      if (!p.postId || existing.has(p.postId)) { skipped++; continue; }
      existing.add(p.postId);

      const row = new Array(HEADERS.length).fill('');
      const set = (name, v) => { row[col[name] - 1] = v == null ? '' : v; };
      set('Post ID', p.postId);
      set('Posted At', p.postedAt ? new Date(p.postedAt) : '');
      set('Added On', now);
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

      const ai = p.ai;
      if (ai) {
        set('CV', ai.cv); set('Role', ai.role); set('Company', ai.company); set('To', ai.toEmail);
        set('Subject', ai.subject); set('Email Body', ai.message); set('Notes', ai.reason);
      }

      if (!ai) {
        set('Status', p.formLinks ? 'FORM' : 'NO_EMAIL');
      } else if (!ai.relevant) {
        set('Status', 'SKIPPED');
      } else if (contacted.has(String(ai.toEmail).toLowerCase())) {
        set('Status', 'DUPLICATE'); set('Notes', 'Already emailed ' + ai.toEmail);
      } else {
        try {
          const draft = createDraft_(ai.toEmail, ai.subject, ai.message, ai.cv, cvCache);
          set('Draft ID', draft.getId());
          set('Status', 'DRAFTED');
          drafted++;
        } catch (err) {
          set('Status', 'READY'); // email written, draft failed → "Create missing drafts"
          set('Notes', 'Draft failed: ' + String(err.message || err).slice(0, 200));
        }
        contacted.add(String(ai.toEmail).toLowerCase());
      }

      const rowNum = sheet.getLastRow() + 1;
      sheet.getRange(rowNum, 1, 1, HEADERS.length).setValues([row]);
      sheet.getRange(rowNum, col['Approve']).insertCheckboxes();
      added++;
    }
    return json_({ ok: true, added, skipped, drafted });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
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

function sendApproved() {
  const sheet = getSheet_();
  const col = colMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  let sentToday = 0;
  for (let r = 1; r < data.length; r++) {
    const at = data[r][col['Sent At'] - 1];
    if (at instanceof Date && Utilities.formatDate(at, tz, 'yyyy-MM-dd') === today) sentToday++;
  }

  let sent = 0, failed = 0, capped = false;
  for (let r = 1; r < data.length; r++) {
    if (data[r][col['Status'] - 1] !== 'DRAFTED' || data[r][col['Approve'] - 1] !== true) continue;
    if (sentToday >= MAX_SENDS_PER_DAY || MailApp.getRemainingDailyQuota() < 5) { capped = true; break; }
    try {
      GmailApp.getDraft(data[r][col['Draft ID'] - 1]).send();
      sheet.getRange(r + 1, col['Status']).setValue('SENT');
      sheet.getRange(r + 1, col['Sent At']).setValue(new Date());
      sent++; sentToday++;
    } catch (err) {
      // e.g. draft deleted in Gmail
      sheet.getRange(r + 1, col['Status']).setValue('ERROR');
      sheet.getRange(r + 1, col['Notes']).setValue('Send failed: ' + String(err.message || err).slice(0, 250));
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
  alert_(`Approved ${n} draft(s). Review them in Gmail before running "Send approved drafts".`);
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
