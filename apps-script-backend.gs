/* ============================================================
   GOOGLE APPS SCRIPT — GTA International Fest Volunteer Backend
   --------------------------------------------------------------
   Handles TWO kinds of submission:
     1) New registration → appends a new row with all student info
     2) Hours-completed submission → finds the student's existing
        row by email + last name, fills in actual hours/notes/timestamp,
        and highlights the row green so GTA can see who completed.

   How to deploy (one-time setup, ~5 min — done by a GTA admin):
     1) Create a new Google Sheet in your GTA account.
        Suggested name: "GTA International Fest — Volunteer Registrations"
     2) In the Sheet menu: Extensions → Apps Script
     3) Delete the default code, paste THIS ENTIRE FILE in
     4) Click Save (disk icon), name the project "GTA Volunteer Backend"
     5) Click Deploy → New deployment
          - Type: Web app
          - Description: GTA Volunteer Form Backend
          - Execute as: Me
          - Who has access: Anyone
        Click Deploy. Authorize when prompted.
     6) Copy the "Web app URL" it shows you (ends in /exec)
     7) Paste that URL into config.js  →  appsScriptUrl
     8) Done!

   IMPORTANT: If you already deployed an older version, redeploy:
     Deploy → Manage deployments → pick your deployment → edit (✏️)
     → Version: New version → Deploy. The URL stays the same.
   ============================================================ */

/* ============================================================
   ADMIN PIN — change this to a strong PIN before deploying.
   The admin dashboard at admin.html requires this PIN to view stats.
   Anyone who knows the PIN can read aggregated stats (no edits).
   Recommended: 8+ characters, mix of letters and numbers.
   ============================================================ */
const ADMIN_PIN = 'CHANGE-ME-12345';

/* ============================================================
   GTA EVENT CONFIG — used in confirmation emails.
   Edit these values so emails sent to students/parents are
   branded correctly for your event.
   ============================================================ */
const GTA_CONFIG = {
  // Display name shown in the "From" field (alongside the GTA admin's email)
  senderName: 'Global Telangana Association',

  // Where students/parents reply if they have questions
  contactEmail: 'volunteers@gta.example.org',

  // Optional: when known, set this to the actual event date — appears in the email
  eventDate: 'Saturday, June 6, 2026 (11:00 AM – 8:00 PM EST)',

  // Optional: a website link for more info
  eventWebsiteUrl: '',  // e.g., 'https://gta-fest.example.org'

  // Set to false to disable confirmation emails entirely
  sendConfirmationEmails: true,

  // Free Groq API key (from console.groq.com/keys) — used to generate
  // personalized welcome letters and appreciation messages.
  // Leave as 'YOUR_GROQ_KEY_HERE' to disable AI personalization (emails
  // still send, just without the AI-written sections).
  groqApiKey: 'YOUR_GROQ_KEY_HERE',

  // --- Email verification gate ---
  // When true, the form is locked until the parent's email is verified
  // via a 6-digit code. Strongly recommended for COPPA-compliant
  // collection of minors' data.
  requireEmailVerification: true
};

// Header row written automatically the first time data arrives.
// Three columns at the end (in CAPS comment) are filled in by the
// hours-completion submission — they stay blank until the kid logs hours.
const HEADERS = [
  'Submitted At', 'Submission ID',
  'First Name', 'Last Name', 'Date of Birth', 'Grade Level',
  'School Name', 'Student ID', 'Student Email', 'Student Phone',
  'Parent/Guardian Name', 'Relationship', 'Parent Email', 'Parent Phone',
  'Emergency Contact Name', 'Emergency Contact Phone', 'Parent Consent',
  'Volunteer Role', 'Organization', 'Activity Date', 'Hours Pledged',
  'Supervisor Name', 'Supervisor Contact', 'Description',
  'Allergies', 'Medical Conditions', 'Medications',
  // ---- Filled in later when the student logs completed hours ----
  'Actual Hours Completed', 'Hours Submitted At', 'Volunteer Notes', 'Hours Receipt ID',
  // ---- Per-row deletion token (used by self-service "delete my registration" link) ----
  'Deletion Token'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'sendOtp')     return handleSendOtp(data);
    if (data.action === 'verifyOtp')   return handleVerifyOtp(data);
    if (data.action === 'submitHours') return handleHoursSubmission(data);
    if (data.action === 'getStats')    return handleGetStats(data);
    if (data.action === 'proxyGroq')   return handleProxyGroq(data);
    return handleRegistration(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

/* ----------------------- New registration ----------------------- */
function handleRegistration(data) {
  // Rate limit: max 5 registrations per email per hour (handles legit retries; blocks spam)
  const emailKey = (data.studentEmail || '') + '|' + (data.parentEmail || '');
  if (!checkRateLimit('reg:' + emailKey, 5, 3600)) {
    return jsonResponse({
      status: 'error',
      message: 'Too many registration attempts from this email recently. Please wait an hour or contact GTA if you need help.'
    });
  }

  // Email verification check — confirm the parent email was OTP-verified
  if (GTA_CONFIG.requireEmailVerification) {
    const token = data._verifiedToken || '';
    const submittedParentEmail = (data.parentEmail || '').toLowerCase().trim();
    const verifiedEmail = token ? CacheService.getScriptCache().get('vtoken:' + token) : null;
    if (!verifiedEmail || verifiedEmail !== submittedParentEmail) {
      return jsonResponse({
        status: 'error',
        message: 'Parent email verification has expired or does not match. Please verify the parent email again.',
        code: 'verification_expired'
      });
    }
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders(sheet);

  // Generate a unique deletion token for this row (used by the "delete my registration" link)
  const deletionToken = generateDeletionToken();
  data._deletionToken = deletionToken;
  data._deletionUrl = buildDeletionUrl(deletionToken);

  const row = [
    data.submittedAtReadable || new Date().toLocaleString(),
    data.submissionId || '',
    data.firstName || '',
    data.lastName || '',
    data.dob || '',
    data.gradeLevel || '',
    data.schoolName || '',
    data.studentId || '',
    data.studentEmail || '',
    data.studentPhone || '',
    data.parentName || '',
    data.parentRelation || '',
    data.parentEmail || '',
    data.parentPhone || '',
    data.emergencyName || '',
    data.emergencyPhone || '',
    data.parentConsent ? 'YES' : 'NO',
    data.activityName || '',
    data.organization || '',
    data.activityDate || '',
    data.hours || '',
    data.supervisorName || '',
    data.supervisorContact || '',
    data.description || '',
    data.allergies || '',
    data.medicalConditions || '',
    data.medications || '',
    // Hours columns — left blank, filled later when student submits hours
    '', '', '', '',
    // Deletion token for self-service removal
    deletionToken
  ];

  sheet.appendRow(row);

  // Fire-and-forget email confirmation — don't fail the registration if email fails
  try {
    sendRegistrationEmail(data);
  } catch (mailErr) {
    Logger.log('Registration email failed: ' + mailErr.toString());
  }

  return jsonResponse({ status: 'ok', submissionId: data.submissionId });
}

/* ----------------------- Hours submission (matches & updates) ----------------------- */
function handleHoursSubmission(data) {
  // Rate limit: 5 hours-submissions per email per hour
  if (!checkRateLimit('hrs:' + (data.email || '').toLowerCase(), 5, 3600)) {
    return jsonResponse({
      status: 'error',
      message: 'Too many hours-submission attempts. Please wait an hour or contact GTA.'
    });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders(sheet);

  const all = sheet.getDataRange().getValues();
  if (all.length < 2) {
    return jsonResponse({
      status: 'error',
      message: "We couldn't find any registrations yet. Please make sure you registered first."
    });
  }

  const headers = all[0];
  const emailCol      = headers.indexOf('Student Email');
  const lastNameCol   = headers.indexOf('Last Name');
  const firstNameCol  = headers.indexOf('First Name');
  const roleCol       = headers.indexOf('Volunteer Role');
  const hrsCompletedCol = headers.indexOf('Actual Hours Completed');
  const hrsSubmittedAtCol = headers.indexOf('Hours Submitted At');
  const notesCol      = headers.indexOf('Volunteer Notes');
  const receiptIdCol  = headers.indexOf('Hours Receipt ID');

  if (emailCol < 0 || lastNameCol < 0 || hrsCompletedCol < 0) {
    return jsonResponse({
      status: 'error',
      message: 'Sheet is missing required columns. Ask the GTA admin to redeploy the latest backend.'
    });
  }

  // Find matching row (most recent if multiple registrations from same kid)
  const targetEmail = (data.email || '').toLowerCase().trim();
  const targetLast  = (data.lastName || '').toLowerCase().trim();
  let matchIdx = -1;
  for (let i = all.length - 1; i >= 1; i--) {
    const rowEmail = String(all[i][emailCol] || '').toLowerCase().trim();
    const rowLast  = String(all[i][lastNameCol] || '').toLowerCase().trim();
    if (rowEmail === targetEmail && rowLast === targetLast) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx === -1) {
    return jsonResponse({
      status: 'error',
      message: "We couldn't find a registration with that email and last name. Double-check your spelling, or register first if you haven't yet."
    });
  }

  const rowNum = matchIdx + 1; // 1-indexed for getRange
  sheet.getRange(rowNum, hrsCompletedCol + 1).setValue(Number(data.hoursCompleted) || data.hoursCompleted);
  sheet.getRange(rowNum, hrsSubmittedAtCol + 1).setValue(data.submittedAtReadable || new Date().toLocaleString());

  // Append notes; if there are already notes, prepend the new ones
  const existingNotes = String(sheet.getRange(rowNum, notesCol + 1).getValue() || '');
  const newNote = (data.dateVolunteered ? `[${data.dateVolunteered}] ` : '') + (data.notes || '');
  const combined = existingNotes
    ? existingNotes + '\n' + newNote
    : newNote;
  sheet.getRange(rowNum, notesCol + 1).setValue(combined);

  if (receiptIdCol >= 0) {
    sheet.getRange(rowNum, receiptIdCol + 1).setValue(data.receiptId || '');
  }

  // Highlight the entire row green so GTA can see at a glance who completed
  sheet.getRange(rowNum, 1, 1, headers.length).setBackground('#d1fae5');

  // Build the volunteer record once (used for both AI generation and the email)
  const cParentEmail = headers.indexOf('Parent Email');
  const cSchool      = headers.indexOf('School Name');
  const volunteerRecord = {
    firstName: all[matchIdx][firstNameCol] || '',
    lastName: all[matchIdx][lastNameCol] || '',
    studentEmail: targetEmail,
    parentEmail: cParentEmail >= 0 ? all[matchIdx][cParentEmail] : '',
    role: all[matchIdx][roleCol] || '',
    school: cSchool >= 0 ? all[matchIdx][cSchool] : '',
    hoursCompleted: data.hoursCompleted,
    dateVolunteered: data.dateVolunteered || '',
    notes: data.notes || '',
    receiptId: data.receiptId || ''
  };

  // Generate the AI appreciation (best-effort) — used in BOTH the email and the PDF certificate
  const appreciation = generateAppreciation(volunteerRecord);
  volunteerRecord._aiAppreciation = appreciation;

  // Send a thank-you email to the volunteer (and CC parent) — fire-and-forget
  try {
    sendHoursConfirmationEmail(volunteerRecord);
  } catch (mailErr) {
    Logger.log('Hours email failed: ' + mailErr.toString());
  }

  return jsonResponse({
    status: 'ok',
    firstName: all[matchIdx][firstNameCol] || '',
    activityName: all[matchIdx][roleCol] || '',
    appreciation: appreciation || ''  // client uses this in the certificate PDF
  });
}

/* ----------------------- Admin dashboard stats ----------------------- */
function handleGetStats(data) {
  // Gate by PIN — without this, anyone could read GTA's volunteer list
  if (!data.adminPin || data.adminPin !== ADMIN_PIN) {
    return jsonResponse({ status: 'error', message: 'Invalid admin PIN.' });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders(sheet);
  const all = sheet.getDataRange().getValues();
  if (all.length < 2) {
    return jsonResponse({
      status: 'ok',
      stats: emptyStats()
    });
  }

  const headers = all[0];
  const idx = (name) => headers.indexOf(name);

  const cFirst = idx('First Name');
  const cLast  = idx('Last Name');
  const cSchool = idx('School Name');
  const cGrade = idx('Grade Level');
  const cRole  = idx('Volunteer Role');
  const cEmail = idx('Student Email');
  const cSubmittedAt = idx('Submitted At');
  const cHoursPledged = idx('Hours Pledged');
  const cHoursCompleted = idx('Actual Hours Completed');
  const cHoursSubmittedAt = idx('Hours Submitted At');
  const cParentPhone = idx('Parent Phone');

  const rows = all.slice(1);

  const totalRegistered = rows.length;
  let totalCompleted = 0;
  let totalHoursPledged = 0;
  let totalHoursCompleted = 0;
  const bySchool = {};
  const byRole = {};
  const byGrade = {};
  const recent = [];
  const pending = [];

  rows.forEach((r) => {
    const hoursPledged = Number(r[cHoursPledged]) || 0;
    const hoursCompleted = Number(r[cHoursCompleted]) || 0;
    totalHoursPledged += hoursPledged;
    totalHoursCompleted += hoursCompleted;
    if (hoursCompleted > 0) totalCompleted++;

    const school = String(r[cSchool] || '(Unspecified)').trim() || '(Unspecified)';
    const role = String(r[cRole] || '(Unspecified)').trim() || '(Unspecified)';
    const grade = String(r[cGrade] || '(Unspecified)').trim() || '(Unspecified)';
    bySchool[school] = (bySchool[school] || 0) + 1;
    byRole[role] = (byRole[role] || 0) + 1;
    byGrade[grade] = (byGrade[grade] || 0) + 1;
  });

  // Recent registrations — last 10, newest first
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 10); i--) {
    const r = rows[i];
    recent.push({
      submittedAt: String(r[cSubmittedAt] || ''),
      name: `${r[cFirst] || ''} ${r[cLast] || ''}`.trim(),
      school: String(r[cSchool] || ''),
      grade: String(r[cGrade] || ''),
      role: String(r[cRole] || ''),
      hoursPledged: r[cHoursPledged] || '',
      hoursCompleted: r[cHoursCompleted] || ''
    });
  }

  // Pending hours — registered but no hours logged
  rows.forEach((r) => {
    const hoursCompleted = Number(r[cHoursCompleted]) || 0;
    if (hoursCompleted === 0) {
      pending.push({
        name: `${r[cFirst] || ''} ${r[cLast] || ''}`.trim(),
        email: String(r[cEmail] || ''),
        parentPhone: String(r[cParentPhone] || ''),
        school: String(r[cSchool] || ''),
        role: String(r[cRole] || ''),
        hoursPledged: r[cHoursPledged] || ''
      });
    }
  });

  return jsonResponse({
    status: 'ok',
    stats: {
      totalRegistered,
      totalCompleted,
      totalPending: totalRegistered - totalCompleted,
      totalHoursPledged,
      totalHoursCompleted,
      completionRate: totalRegistered > 0 ? Math.round((totalCompleted / totalRegistered) * 100) : 0,
      bySchool: sortDictDesc(bySchool),
      byRole: sortDictDesc(byRole),
      byGrade: sortGrades(byGrade),
      recent,
      pending,
      generatedAt: new Date().toLocaleString()
    }
  });
}

function sortDictDesc(obj) {
  return Object.keys(obj)
    .map(k => ({ label: k, count: obj[k] }))
    .sort((a, b) => b.count - a.count);
}

function sortGrades(obj) {
  // Order grades naturally (6th, 7th, 8th, ..., 12th)
  const order = ['6th Grade','7th Grade','8th Grade','9th Grade','10th Grade','11th Grade','12th Grade'];
  return order
    .filter(g => obj[g])
    .map(g => ({ label: g, count: obj[g] }))
    .concat(
      Object.keys(obj)
        .filter(k => order.indexOf(k) === -1)
        .map(k => ({ label: k, count: obj[k] }))
    );
}

function emptyStats() {
  return {
    totalRegistered: 0, totalCompleted: 0, totalPending: 0,
    totalHoursPledged: 0, totalHoursCompleted: 0, completionRate: 0,
    bySchool: [], byRole: [], byGrade: [], recent: [], pending: [],
    generatedAt: new Date().toLocaleString()
  };
}

/* ----------------------- Header bootstrap (idempotent) ----------------------- */
function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setFontWeight('bold')
         .setBackground('#0d6efd')
         .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return;
  }
  // If old version of the sheet exists without the new "hours" columns, add them
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newCols = HEADERS.filter((h) => existing.indexOf(h) === -1);
  if (newCols.length > 0) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, newCols.length).setValues([newCols])
         .setFontWeight('bold')
         .setBackground('#0d6efd')
         .setFontColor('#ffffff');
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   RATE LIMITING — protects against spam / runaway scripts
   --------------------------------------------------------------
   Uses Apps Script's CacheService (max 6 hour TTL, server-side
   memory). Each identifier (email or session token) is allowed
   N requests per window. Returns true if allowed, false if blocked.
   ============================================================ */
function checkRateLimit(identifier, maxPerWindow, windowSeconds) {
  if (!identifier) return true;  // no identifier → can't track, allow
  try {
    const cache = CacheService.getScriptCache();
    const key = 'rl:' + (identifier || '').toString().toLowerCase().substring(0, 100);
    const current = parseInt(cache.get(key) || '0', 10);
    if (current >= maxPerWindow) return false;
    cache.put(key, String(current + 1), windowSeconds);
    return true;
  } catch (e) {
    Logger.log('Rate-limit check failed (allowing request): ' + e.toString());
    return true;
  }
}

/* ============================================================
   GROQ PROXY — keeps the API key on the server, never in the browser
   --------------------------------------------------------------
   Client sends { action: 'proxyGroq', sessionId, messages, ... }.
   This forwards to Groq using GTA_CONFIG.groqApiKey and returns
   the assistant's reply. Rate-limited per session.
   ============================================================ */
function handleProxyGroq(data) {
  // Rate limit by session — 30 requests/minute, 200/hour per session
  const session = data.sessionId || 'anonymous';
  if (!checkRateLimit('groq-min:' + session, 30, 60)) {
    return jsonResponse({ status: 'error', message: 'Too many AI requests. Please wait a minute and try again.' });
  }
  if (!checkRateLimit('groq-hour:' + session, 200, 3600)) {
    return jsonResponse({ status: 'error', message: 'AI usage limit reached for this session. Try again later.' });
  }

  if (!hasGroqKeyServer()) {
    return jsonResponse({ status: 'error', message: 'Server-side AI is not configured. Ask the GTA admin to set GTA_CONFIG.groqApiKey.' });
  }

  // Validate inputs
  if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) {
    return jsonResponse({ status: 'error', message: 'Invalid request: messages array required.' });
  }
  if (data.messages.length > 25) {
    return jsonResponse({ status: 'error', message: 'Too many messages in conversation.' });
  }

  // Constrain max_tokens to avoid runaway cost
  const maxTokens = Math.min(parseInt(data.maxTokens || 250, 10), 500);
  const temperature = Math.min(Math.max(parseFloat(data.temperature || 0.5), 0), 1.5);

  try {
    const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + GTA_CONFIG.groqApiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: data.messages,
        temperature: temperature,
        max_tokens: maxTokens
      }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('Proxy Groq non-200: ' + response.getResponseCode());
      return jsonResponse({ status: 'error', message: 'AI service unavailable. Please try again.' });
    }
    const result = JSON.parse(response.getContentText());
    const reply = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content || '').trim();
    return jsonResponse({ status: 'ok', reply: reply, model: 'llama-3.1-8b-instant' });
  } catch (err) {
    Logger.log('Proxy Groq failed: ' + err.toString());
    return jsonResponse({ status: 'error', message: 'AI service error.' });
  }
}

/* ============================================================
   EMAIL VERIFICATION (OTP) — gates the registration form
   --------------------------------------------------------------
   Two-step flow:
     1) Client posts {action: 'sendOtp', email}
        → server stores 6-digit code in CacheService (10 min TTL)
        → server sends code to that email via MailApp
     2) Client posts {action: 'verifyOtp', email, code}
        → server checks code, issues a verifiedToken (6 h validity)
        → client passes that token with the registration submission
   handleRegistration verifies the token before accepting the row.
   ============================================================ */
function handleSendOtp(data) {
  const email = (data.email || '').toLowerCase().trim();
  if (!isValidEmailFormat(email)) {
    return jsonResponse({ status: 'error', message: 'Please enter a valid email address.' });
  }
  // Rate limit: 3 codes per email per hour
  if (!checkRateLimit('otp-send:' + email, 3, 3600)) {
    return jsonResponse({ status: 'error', message: 'Too many code requests for this email. Try again in an hour.' });
  }

  // Generate a 6-digit code (zero-padded)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('otp:' + email, code, 600); // 10 min TTL

  // Skip replyTo if it still contains an obvious placeholder ('example.', 'YOUR_', etc.)
  // — invalid replyTo addresses are a strong spam-filter signal.
  const reply = (GTA_CONFIG.contactEmail || '').toString();
  const replyToVal = (reply && !/example\.|YOUR_|change.?me/i.test(reply)) ? reply : '';

  Logger.log('OTP send: to=' + email + ' replyTo=' + (replyToVal || '(none)') + ' quotaRemaining=' + MailApp.getRemainingDailyQuota());

  try {
    MailApp.sendEmail(email, 'Your GTA Volunteer verification code: ' + code, buildOtpPlain(code), {
      name: GTA_CONFIG.senderName || 'GTA Volunteer',
      replyTo: replyToVal,
      htmlBody: buildOtpHtml(code)
    });
    Logger.log('OTP send OK for ' + email);
    return jsonResponse({ status: 'ok', message: 'Code sent. Check your inbox (and spam folder).' });
  } catch (err) {
    Logger.log('OTP send FAILED: ' + err.toString());
    return jsonResponse({ status: 'error', message: 'Could not send the code right now: ' + err.toString().substring(0, 120) });
  }
}

function handleVerifyOtp(data) {
  const email = (data.email || '').toLowerCase().trim();
  const code = (data.code || '').trim();

  if (!checkRateLimit('otp-verify:' + email, 8, 3600)) {
    return jsonResponse({ status: 'error', message: 'Too many verification attempts. Try again later.' });
  }
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ status: 'error', message: 'Code must be 6 digits.' });
  }

  const cache = CacheService.getScriptCache();
  const stored = cache.get('otp:' + email);
  if (!stored) {
    return jsonResponse({ status: 'error', message: 'Code expired or not found. Please request a new code.' });
  }
  if (stored !== code) {
    return jsonResponse({ status: 'error', message: 'Incorrect code. Please try again.' });
  }

  // Code matched — issue a verification token (6 h validity)
  cache.remove('otp:' + email);
  const token = 'VER-' + Utilities.getUuid().replace(/-/g, '').substring(0, 24);
  cache.put('vtoken:' + token, email, 21600); // 6 h

  return jsonResponse({ status: 'ok', verifiedToken: token, email: email });
}

function isValidEmailFormat(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

function buildOtpHtml(code) {
  return '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 460px; margin: 0 auto; background: #ffffff;">' +
    '<div style="background: linear-gradient(135deg, #c1272d, #ff6b35); color: white; padding: 24px; text-align: center;">' +
      '<h2 style="margin: 0; font-size: 18px; font-weight: 700;">Global Telangana Association</h2>' +
      '<p style="margin: 4px 0 0; font-size: 13px; opacity: 0.95;">GTA International Fest — Volunteer Verification</p>' +
    '</div>' +
    '<div style="padding: 24px; color: #1f2937;">' +
      '<p style="margin: 0 0 12px; line-height: 1.5;">Hi,</p>' +
      '<p style="margin: 0 0 16px; line-height: 1.5;">A volunteer registration was started for your child using this email. Use this code to confirm:</p>' +
      '<div style="text-align: center; padding: 22px; background: #fff8ec; border: 2px solid #d4a437; border-radius: 8px; margin: 16px 0;">' +
        '<div style="font-size: 38px; font-weight: 700; letter-spacing: 8px; color: #c1272d; font-family: \'Courier New\', monospace;">' + code + '</div>' +
      '</div>' +
      '<p style="margin: 16px 0 0; font-size: 13px; color: #6b7280; line-height: 1.5;">This code expires in <strong>10 minutes</strong>. If you did not request this, you can safely ignore this email — no action needed.</p>' +
    '</div>' +
    '<div style="padding: 14px 24px; background: #f5f7fb; text-align: center; font-size: 11px; color: #6b7280;">' +
      'Global Telangana Association · Automated verification' +
    '</div>' +
  '</div>';
}

function buildOtpPlain(code) {
  return [
    'GTA International Fest — Volunteer Verification',
    '',
    'A volunteer registration was started for your child using this email.',
    '',
    'Your code: ' + code,
    '',
    'This code expires in 10 minutes. If you did not request this, ignore this email.',
    '',
    '— Global Telangana Association'
  ].join('\n');
}

/* ============================================================
   SELF-SERVICE DELETION
   --------------------------------------------------------------
   Each registration gets a unique deletion token. The confirmation
   email includes a link with that token. Clicking the link routes
   to doGet → handleDeleteConfirm, which shows a "are you sure?"
   page. Submitting deletes the row.
   ============================================================ */
function generateDeletionToken() {
  return 'DEL-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
}

function buildDeletionUrl(token) {
  // ScriptApp.getService().getUrl() returns the deployed web-app URL
  try {
    return ScriptApp.getService().getUrl() + '?action=deleteRequest&token=' + encodeURIComponent(token);
  } catch (e) {
    return '';
  }
}

function handleDeleteRequest(token) {
  if (!token) {
    return htmlResponse('<h2>Missing token</h2><p>This link looks incomplete. Please use the link from your confirmation email.</p>', 'Deletion Request — GTA');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const all = sheet.getDataRange().getValues();
  if (all.length < 2) {
    return htmlResponse('<h2>Record not found</h2><p>This deletion link is no longer valid (the record may already be removed).</p>', 'Deletion Request — GTA');
  }
  const headers = all[0];
  const tokenCol = headers.indexOf('Deletion Token');
  const firstNameCol = headers.indexOf('First Name');
  const lastNameCol  = headers.indexOf('Last Name');
  const emailCol     = headers.indexOf('Student Email');

  let matchIdx = -1;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][tokenCol] || '') === token) { matchIdx = i; break; }
  }
  if (matchIdx === -1) {
    return htmlResponse('<h2>Record not found</h2><p>This deletion link is no longer valid (the record may already be removed). If this is a mistake, please contact the GTA team.</p>', 'Deletion Request — GTA');
  }

  const fullName = (all[matchIdx][firstNameCol] || '') + ' ' + (all[matchIdx][lastNameCol] || '');
  const email = all[matchIdx][emailCol] || '';

  // Show confirmation page with a confirm button (which POSTs to delete)
  const confirmUrl = ScriptApp.getService().getUrl() + '?action=deleteConfirm&token=' + encodeURIComponent(token);
  const html = `
    <div style="font-family: system-ui, Arial, sans-serif; max-width: 480px; margin: 40px auto; padding: 24px; background: white; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.1);">
      <h2 style="color: #c1272d; margin-top: 0;">Delete your GTA volunteer registration?</h2>
      <p style="color: #1f2937; line-height: 1.6;">We found a registration matching this token:</p>
      <div style="background: #f5f7fb; padding: 12px 16px; border-radius: 8px; margin: 12px 0;">
        <strong>${escapeHtmlEmail(fullName.trim())}</strong><br>
        <span style="color: #6b7280; font-size: 14px;">${escapeHtmlEmail(email)}</span>
      </div>
      <p style="color: #1f2937; line-height: 1.6;">If you click the button below, this record will be <strong>permanently removed</strong> from GTA's volunteer sheet. This cannot be undone.</p>
      <div style="margin-top: 24px;">
        <a href="${confirmUrl}" style="display: inline-block; padding: 12px 20px; background: #c1272d; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Yes, delete my registration</a>
        <a href="${ScriptApp.getService().getUrl()}" style="display: inline-block; padding: 12px 20px; color: #6b7280; text-decoration: none; margin-left: 8px;">Cancel</a>
      </div>
      <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">Contact: ${escapeHtmlEmail(GTA_CONFIG.contactEmail)}</p>
    </div>
  `;
  return htmlResponse(html, 'Confirm deletion — GTA');
}

function handleDeleteConfirm(token) {
  if (!token) {
    return htmlResponse('<h2>Missing token</h2><p>This link looks incomplete.</p>', 'Deletion — GTA');
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const all = sheet.getDataRange().getValues();
  const headers = all[0];
  const tokenCol = headers.indexOf('Deletion Token');
  let matchIdx = -1;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][tokenCol] || '') === token) { matchIdx = i; break; }
  }
  if (matchIdx === -1) {
    return htmlResponse('<h2>Already removed</h2><p>This record is no longer in our system. Nothing more to do.</p>', 'Deletion — GTA');
  }
  sheet.deleteRow(matchIdx + 1);
  return htmlResponse(`
    <div style="font-family: system-ui, Arial, sans-serif; max-width: 480px; margin: 40px auto; padding: 24px; background: white; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); text-align: center;">
      <div style="width: 64px; height: 64px; margin: 0 auto 16px; background: #198754; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px;">✓</div>
      <h2 style="color: #198754; margin: 0 0 8px;">Registration deleted</h2>
      <p style="color: #1f2937; line-height: 1.6;">Your GTA volunteer registration has been permanently removed. Thank you for letting us know.</p>
      <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">Questions? Email ${escapeHtmlEmail(GTA_CONFIG.contactEmail)}</p>
    </div>
  `, 'Deletion confirmed — GTA');
}

function htmlResponse(body, title) {
  const t = title || 'GTA Volunteer App';
  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title>
    <style>body{margin:0;padding:0;background:#fff8ec;font-family:system-ui,Arial,sans-serif;}</style>
    </head><body>${body}</body></html>
  `).setTitle(t);
}

// doGet handles delete-link clicks AND a default health-check page.
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'deleteRequest') return handleDeleteRequest(params.token);
  if (params.action === 'deleteConfirm') return handleDeleteConfirm(params.token);
  return ContentService
    .createTextOutput('GTA Volunteer Backend is running. POST registrations, hours, AI proxy, or admin stats here.')
    .setMimeType(ContentService.MimeType.TEXT);
}

/* ============================================================
   EMAIL — confirmation messages
   --------------------------------------------------------------
   Uses MailApp.sendEmail (built into Apps Script).
   Daily quota: 100 emails/day on free Gmail; 1500/day on Workspace.
   The first time these run, Google will ask the GTA admin to
   authorize "Send email as you" — click through to allow.
   ============================================================ */

function sendRegistrationEmail(data) {
  if (!GTA_CONFIG.sendConfirmationEmails) return;
  if (!data || !data.studentEmail) {
    Logger.log('sendRegistrationEmail called with no data — skipping. (This is normal if you ran it manually from the editor.)');
    return;
  }

  // Generate the personalized AI welcome (best-effort; falls back to empty if Groq unavailable)
  data._aiWelcome = generateWelcomeMessage(data);

  const subject = 'Welcome! Your GTA International Fest volunteer registration is confirmed';
  const html = buildRegistrationHtml(data);
  const plain = buildRegistrationPlain(data);

  const options = {
    htmlBody: html,
    name: GTA_CONFIG.senderName,
    replyTo: GTA_CONFIG.contactEmail || ''
  };
  if (data.parentEmail && data.parentEmail !== data.studentEmail) {
    options.cc = data.parentEmail;
  }

  MailApp.sendEmail(data.studentEmail, subject, plain, options);
}

function sendHoursConfirmationEmail(data) {
  if (!GTA_CONFIG.sendConfirmationEmails) return;
  if (!data || !data.studentEmail) {
    Logger.log('sendHoursConfirmationEmail called with no data — skipping. (This is normal if you ran it manually from the editor.)');
    return;
  }

  // Generate the personalized appreciation (also passed back to client for the certificate PDF)
  if (!data._aiAppreciation) {
    data._aiAppreciation = generateAppreciation(data);
  }

  const subject = `Thank you ${data.firstName || ''}! Your ${data.hoursCompleted} volunteer hours have been recorded`;
  const html = buildHoursHtml(data);
  const plain = buildHoursPlain(data);

  const options = {
    htmlBody: html,
    name: GTA_CONFIG.senderName,
    replyTo: GTA_CONFIG.contactEmail || ''
  };
  if (data.parentEmail && data.parentEmail !== data.studentEmail) {
    options.cc = data.parentEmail;
  }

  MailApp.sendEmail(data.studentEmail, subject, plain, options);
}

/* ----------------------- Email templates ----------------------- */
function buildRegistrationHtml(d) {
  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  const websiteLink = GTA_CONFIG.eventWebsiteUrl
    ? `<p style="margin: 16px 0 0;"><a href="${GTA_CONFIG.eventWebsiteUrl}" style="color:#0d6efd;">More about the event →</a></p>`
    : '';
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: linear-gradient(135deg, #0d6efd, #0a58ca); color: white; padding: 28px 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700;">Global Telangana Association</h1>
    <p style="margin: 6px 0 0; opacity: 0.9; font-size: 15px;">GTA International Fest — Volunteer Registration</p>
  </div>

  <div style="padding: 28px 24px; color: #1f2937; line-height: 1.6;">
    <h2 style="margin: 0 0 12px; font-size: 20px; color: #198754;">You're registered! 🎉</h2>
    <p style="margin: 0 0 12px;">Hi ${escapeHtmlEmail(d.firstName) || 'there'},</p>
    ${d._aiWelcome ? `
    <div style="background: linear-gradient(135deg, #fff8ec, #fdf6e3); border-left: 4px solid #d4a437; padding: 14px 18px; border-radius: 6px; margin: 0 0 18px; font-size: 15px; line-height: 1.6;">
      ${escapeHtmlEmail(d._aiWelcome).split('\n').map(p => p.trim()).filter(Boolean).join('<br><br>')}
      <div style="margin-top: 10px; font-size: 11px; color: #92741b; font-style: italic;">
        ✨ A personalized welcome generated just for you by AI based on your registration.
      </div>
    </div>
    ` : `
    <p style="margin: 0 0 20px;">Thank you for signing up to volunteer at the <strong>GTA International Fest</strong>! We're excited to have you on the team. Your registration has been received and recorded by the GTA volunteer coordinator.</p>
    `}

    <div style="background: #f5f7fb; padding: 16px 20px; border-radius: 10px; border-left: 4px solid #0d6efd; margin: 20px 0;">
      <strong style="color: #0a58ca;">Your registration details</strong>
      <table style="width: 100%; margin-top: 10px; font-size: 14px; border-collapse: collapse;">
        <tr><td style="padding: 4px 0; color: #6b7280; width: 140px;">Volunteer:</td><td style="padding: 4px 0;"><strong>${escapeHtmlEmail(fullName)}</strong></td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">School / Grade:</td><td style="padding: 4px 0;">${escapeHtmlEmail(d.schoolName)} · ${escapeHtmlEmail(d.gradeLevel)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Volunteer role:</td><td style="padding: 4px 0;">${escapeHtmlEmail(d.activityName)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Hours pledged:</td><td style="padding: 4px 0;">${escapeHtmlEmail(d.hours)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Event date:</td><td style="padding: 4px 0;">${escapeHtmlEmail(GTA_CONFIG.eventDate)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Submission ID:</td><td style="padding: 4px 0; font-family: monospace; font-size: 12px;">${escapeHtmlEmail(d.submissionId)}</td></tr>
      </table>
    </div>

    <h3 style="margin: 24px 0 8px; font-size: 16px; color: #0a58ca;">What happens next?</h3>
    <ol style="margin: 0 0 20px; padding-left: 20px;">
      <li style="margin-bottom: 8px;">The GTA volunteer coordinator will email you with the <strong>exact event date, venue, and your assigned shift</strong>.</li>
      <li style="margin-bottom: 8px;">Show up on event day — bring water, wear comfortable clothes, and be ready to have fun.</li>
      <li style="margin-bottom: 8px;"><strong>After volunteering, come back to the form</strong> and tap the <em>"⏱️ Submit Hours"</em> tab to log your actual hours. You'll get an official receipt to use for school community-service credit.</li>
    </ol>

    <p style="margin: 24px 0 8px;">Questions? Just reply to this email or reach out at <a href="mailto:${escapeHtmlEmail(GTA_CONFIG.contactEmail)}" style="color: #0d6efd;">${escapeHtmlEmail(GTA_CONFIG.contactEmail)}</a>.</p>
    ${websiteLink}
    <p style="margin: 24px 0 0;">Thanks for being part of our community,<br><strong>The GTA Volunteer Team</strong></p>
  </div>

  <div style="padding: 16px 24px; background: #f5f7fb; text-align: center; font-size: 11px; color: #6b7280;">
    Global Telangana Association · This is an automated confirmation. ${d.parentEmail ? "A copy was also sent to your parent's email." : ''}
    ${d._deletionUrl ? `
    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e5e7eb; line-height: 1.6;">
      Need to update or remove your registration? <a href="${d._deletionUrl}" style="color: #c1272d;">Delete my registration</a><br>
      <span style="font-size: 10px;">(This link is unique to your registration — anyone with the link can delete this record. Keep it private.)</span>
    </div>` : ''}
  </div>
</div>`;
}

function buildRegistrationPlain(d) {
  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  const aiBlock = d._aiWelcome ? [d._aiWelcome, '', '(✨ Personalized message above generated by AI based on your registration.)', ''] : [];
  return [
    `Hi ${d.firstName || 'there'},`,
    '',
    `You're registered to volunteer at the GTA International Fest! 🎉`,
    '',
    ...aiBlock,
    `YOUR REGISTRATION DETAILS`,
    `------------------------------`,
    `Volunteer: ${fullName}`,
    `School / Grade: ${d.schoolName || ''} · ${d.gradeLevel || ''}`,
    `Volunteer role: ${d.activityName || ''}`,
    `Hours pledged: ${d.hours || ''}`,
    `Event date: ${GTA_CONFIG.eventDate}`,
    `Submission ID: ${d.submissionId || ''}`,
    '',
    `WHAT HAPPENS NEXT?`,
    `1) The GTA volunteer coordinator will email you the exact event date, venue, and assigned shift.`,
    `2) Show up on event day — bring water, wear comfortable clothes, be ready to help.`,
    `3) After volunteering, return to the form and tap "Submit Hours" to log your actual hours and get an official receipt for community-service credit.`,
    '',
    `Questions? Reply to this email or contact ${GTA_CONFIG.contactEmail}.`,
    GTA_CONFIG.eventWebsiteUrl ? `\nMore about the event: ${GTA_CONFIG.eventWebsiteUrl}` : '',
    '',
    `Thanks for being part of our community,`,
    `The GTA Volunteer Team`,
    '',
    `--`,
    `Global Telangana Association · Automated confirmation`,
    d._deletionUrl ? `\nNeed to update or remove your registration? Click here to delete: ${d._deletionUrl}\n(This link is unique to your registration — keep it private.)` : ''
  ].join('\n');
}

function buildHoursHtml(d) {
  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: linear-gradient(135deg, #0d6efd, #0a58ca); color: white; padding: 28px 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700;">Global Telangana Association</h1>
    <p style="margin: 6px 0 0; opacity: 0.9; font-size: 15px;">Volunteer Hours Confirmed</p>
  </div>

  <div style="padding: 28px 24px; color: #1f2937; line-height: 1.6;">
    <h2 style="margin: 0 0 12px; font-size: 20px; color: #198754;">Thank you, ${escapeHtmlEmail(d.firstName) || 'volunteer'}! 🙏</h2>
    ${d._aiAppreciation ? `
    <div style="background: linear-gradient(135deg, #fff8ec, #fdf6e3); border-left: 4px solid #d4a437; padding: 14px 18px; border-radius: 6px; margin: 0 0 18px; font-size: 15px; line-height: 1.6; font-style: italic;">
      ${escapeHtmlEmail(d._aiAppreciation).split('\n').map(p => p.trim()).filter(Boolean).join('<br><br>')}
      <div style="margin-top: 10px; font-size: 11px; color: #92741b; font-style: normal;">
        ✨ Personalized appreciation written for you by AI based on your service.
      </div>
    </div>
    ` : `
    <p style="margin: 0 0 20px;">Your volunteer hours from the <strong>GTA International Fest</strong> have been recorded. We so appreciate the time you gave to make the event a success.</p>
    `}

    <div style="text-align: center; padding: 28px 16px; background: linear-gradient(135deg, #d1fae5, #a7f3d0); border-radius: 12px; margin: 24px 0;">
      <div style="font-size: 13px; color: #065f46; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Hours volunteered</div>
      <div style="font-size: 56px; font-weight: 700; color: #198754; line-height: 1.1; margin: 8px 0;">${escapeHtmlEmail(d.hoursCompleted)}</div>
      <div style="font-size: 13px; color: #065f46;">in service to the GTA International Fest</div>
    </div>

    <div style="background: #f5f7fb; padding: 16px 20px; border-radius: 10px; margin: 20px 0; font-size: 14px;">
      <strong>Your record</strong><br>
      Volunteer: ${escapeHtmlEmail(fullName)}<br>
      School: ${escapeHtmlEmail(d.school)}<br>
      Role: ${escapeHtmlEmail(d.role)}<br>
      ${d.dateVolunteered ? `Date(s): ${escapeHtmlEmail(d.dateVolunteered)}<br>` : ''}
      Receipt ID: <span style="font-family: monospace; font-size: 12px;">${escapeHtmlEmail(d.receiptId)}</span>
    </div>

    <h3 style="margin: 24px 0 8px; font-size: 16px; color: #0a58ca;">Using these hours for community-service credit</h3>
    <p style="margin: 0 0 20px;">A polished PDF receipt was downloaded to your device when you submitted hours — keep it for your school. If your school needs verification, they can email <a href="mailto:${escapeHtmlEmail(GTA_CONFIG.contactEmail)}" style="color: #0d6efd;">${escapeHtmlEmail(GTA_CONFIG.contactEmail)}</a> with the receipt ID above.</p>

    <p style="margin: 24px 0 0;">From all of us at GTA — thank you for showing up for the community.<br><strong>The GTA Volunteer Team</strong></p>
  </div>

  <div style="padding: 16px 24px; background: #f5f7fb; text-align: center; font-size: 11px; color: #6b7280;">
    Global Telangana Association · This confirms your volunteer hours are on file with GTA.
  </div>
</div>`;
}

function buildHoursPlain(d) {
  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  const aiBlock = d._aiAppreciation ? [d._aiAppreciation, '', '(✨ Personalized message above generated by AI based on your service.)', ''] : [];
  return [
    `Hi ${d.firstName || 'there'},`,
    '',
    `Thank you for volunteering at the GTA International Fest! 🙏`,
    '',
    ...aiBlock,
    `Your volunteer hours have been recorded:`,
    ``,
    `   >>>  ${d.hoursCompleted} hours  <<<`,
    '',
    `Volunteer: ${fullName}`,
    `School: ${d.school || ''}`,
    `Role: ${d.role || ''}`,
    d.dateVolunteered ? `Date(s): ${d.dateVolunteered}` : '',
    `Receipt ID: ${d.receiptId || ''}`,
    '',
    `A PDF receipt was downloaded to your device when you submitted — keep it for your school's community-service credit. If your school needs verification, they can contact ${GTA_CONFIG.contactEmail} with the receipt ID above.`,
    '',
    `From all of us at GTA — thank you for showing up for the community.`,
    `The GTA Volunteer Team`,
    '',
    `--`,
    `Global Telangana Association · Automated confirmation`
  ].join('\n');
}

function escapeHtmlEmail(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   AI PERSONALIZATION (optional — uses Groq free tier)
   ============================================================ */
function hasGroqKeyServer() {
  return GTA_CONFIG.groqApiKey
      && GTA_CONFIG.groqApiKey.length > 10
      && GTA_CONFIG.groqApiKey.indexOf('YOUR_GROQ') === -1;
}

function callGroqServer(prompt, maxTokens) {
  try {
    const response = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + GTA_CONFIG.groqApiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: maxTokens || 220
      }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('Groq non-200: ' + response.getResponseCode() + ' — ' + response.getContentText().substring(0, 200));
      return '';
    }
    const result = JSON.parse(response.getContentText());
    return (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content || '').trim();
  } catch (err) {
    Logger.log('Groq call failed: ' + err.toString());
    return '';
  }
}

function generateWelcomeMessage(data) {
  if (!hasGroqKeyServer()) return '';
  const prompt =
    'Write a warm, personal 3-4 sentence welcome message for a student volunteer registering for the GTA International Fest (a Telangana cultural celebration). ' +
    'Speak directly to the student. Reference one or two specific things from their info to make it feel personal. ' +
    'Sound like a warm volunteer coordinator (not corporate). No greeting line ("Hi X,") and no closing — just the message body. ' +
    'No emojis. Plain text only.\n\n' +
    'Student details:\n' +
    '- Name: ' + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
    '- Grade: ' + (data.gradeLevel || '') + '\n' +
    '- School: ' + (data.schoolName || '') + '\n' +
    '- Volunteer role: ' + (data.activityName || '') + '\n' +
    '- Hours pledged: ' + (data.hours || '') + '\n' +
    '- Notes about themselves (skills, languages, friends, etc.): ' + (data.description || '(none provided)');
  return callGroqServer(prompt, 220);
}

/* ============================================================
   _authorizeAndTest — RUN THIS ONCE FROM THE EDITOR
   --------------------------------------------------------------
   Triggers Google's authorization prompts for all permissions
   the script needs (Sheet, Email, External fetch). Also sends
   yourself a test confirmation email so you know everything works.
   --------------------------------------------------------------
   How to run:
     1. In the Apps Script editor, function dropdown (top toolbar)
     2. Pick "_authorizeAndTest"
     3. Click ▶ Run
     4. Authorize when prompted
     5. Check the Execution log (View → Logs) for results
     6. Check your inbox for the test email
   ============================================================ */
function _authorizeAndTest() {
  Logger.log('--- _authorizeAndTest starting ---');

  // 1. Test Sheet access
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    Logger.log('✓ Sheet access OK. Active sheet: "' + sheet.getName() + '" with ' + sheet.getLastRow() + ' rows.');
  } catch (e) {
    Logger.log('✗ Sheet access FAILED: ' + e.toString());
  }

  // 2. Test Groq (UrlFetchApp + Groq key)
  try {
    if (!hasGroqKeyServer()) {
      Logger.log('⚠ Groq key not set in GTA_CONFIG.groqApiKey — AI personalization will be skipped. (Emails still work without it.)');
    } else {
      const sample = generateWelcomeMessage({
        firstName: 'Test', lastName: 'Student',
        gradeLevel: '9th Grade', schoolName: 'Demo High School',
        activityName: 'Registration desk', hours: '4',
        description: 'I speak Telugu and English and love meeting new people.'
      });
      if (sample) {
        Logger.log('✓ Groq AI generation OK. Sample welcome:\n' + sample);
      } else {
        Logger.log('✗ Groq returned empty. Check the key, or check the execution Logs above.');
      }
    }
  } catch (e) {
    Logger.log('✗ Groq call FAILED: ' + e.toString());
  }

  // 3. Test sending email — sends a fake confirmation to YOUR account
  try {
    const myEmail = Session.getActiveUser().getEmail();
    if (!myEmail) {
      Logger.log('⚠ Could not get your email address — skipping email test.');
    } else {
      sendRegistrationEmail({
        firstName: 'Test', lastName: 'Volunteer',
        gradeLevel: '10th Grade', schoolName: 'Demo High School',
        studentEmail: myEmail,
        parentEmail: '',
        activityName: 'Registration desk',
        hours: '4',
        description: 'Test record from _authorizeAndTest. Safe to ignore.',
        submissionId: 'TEST-' + Date.now()
      });
      Logger.log('✓ Test confirmation email sent to ' + myEmail + '. Check your inbox.');
    }
  } catch (e) {
    Logger.log('✗ Email send FAILED: ' + e.toString());
  }

  Logger.log('--- _authorizeAndTest finished ---');
}

function generateAppreciation(data) {
  if (!hasGroqKeyServer()) return '';
  const prompt =
    'Write a warm, personal 2-3 sentence appreciation note thanking a student volunteer for their service at the GTA International Fest. ' +
    'Reference one or two specific things from their volunteer record to make every student feel seen. ' +
    'Sound genuine and warm, not corporate. No greeting line, no closing — just the message body. No emojis. Plain text only.\n\n' +
    'Volunteer record:\n' +
    '- Name: ' + (data.firstName || '') + ' ' + (data.lastName || '') + '\n' +
    '- School: ' + (data.school || '') + '\n' +
    '- Role they volunteered as: ' + (data.role || '') + '\n' +
    '- Hours volunteered: ' + (data.hoursCompleted || '') + '\n' +
    '- Notes about what they did: ' + (data.notes || '(no notes)');
  return callGroqServer(prompt, 180);
}
