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
  eventDate: 'TBD — the GTA team will email you with the exact date',

  // Optional: a website link for more info
  eventWebsiteUrl: '',  // e.g., 'https://gta-fest.example.org'

  // Set to false to disable confirmation emails entirely
  sendConfirmationEmails: true
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
  'Actual Hours Completed', 'Hours Submitted At', 'Volunteer Notes', 'Hours Receipt ID'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'submitHours') {
      return handleHoursSubmission(data);
    }
    if (data.action === 'getStats') {
      return handleGetStats(data);
    }
    return handleRegistration(data);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

/* ----------------------- New registration ----------------------- */
function handleRegistration(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  ensureHeaders(sheet);

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
    '', '', '', ''
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

  // Send a thank-you email to the volunteer (and CC parent) — fire-and-forget
  try {
    const cParentEmail = headers.indexOf('Parent Email');
    const cSchool      = headers.indexOf('School Name');
    sendHoursConfirmationEmail({
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
    });
  } catch (mailErr) {
    Logger.log('Hours email failed: ' + mailErr.toString());
  }

  return jsonResponse({
    status: 'ok',
    firstName: all[matchIdx][firstNameCol] || '',
    activityName: all[matchIdx][roleCol] || ''
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

// Optional: lets you verify the URL is alive by visiting it in a browser
function doGet() {
  return ContentService
    .createTextOutput('GTA Volunteer Backend is running. POST registrations or hours submissions here.')
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
  if (!data.studentEmail) return;

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
  if (!data.studentEmail) return;

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
    <p style="margin: 0 0 20px;">Thank you for signing up to volunteer at the <strong>GTA International Fest</strong>! We're excited to have you on the team. Your registration has been received and recorded by the GTA volunteer coordinator.</p>

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
  </div>
</div>`;
}

function buildRegistrationPlain(d) {
  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim();
  return [
    `Hi ${d.firstName || 'there'},`,
    '',
    `You're registered to volunteer at the GTA International Fest! 🎉`,
    '',
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
    `Global Telangana Association · Automated confirmation`
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
    <p style="margin: 0 0 20px;">Your volunteer hours from the <strong>GTA International Fest</strong> have been recorded. We so appreciate the time you gave to make the event a success.</p>

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
  return [
    `Hi ${d.firstName || 'there'},`,
    '',
    `Thank you for volunteering at the GTA International Fest! 🙏`,
    '',
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
