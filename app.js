/* ============================================================
   Student Volunteer Form — App Logic
   - Collects & validates form data
   - Generates a PDF report and downloads it to the device
   - Syncs the entry to a Google Sheet via Apps Script web app
   - Queues submissions when offline; auto-resyncs when back online
   ============================================================ */

/* ============================================================
   SCHOOL EMAIL DETECTOR — keep school addresses out of the form.
   School districts (Forsyth, Gwinnett, etc.) block our automated
   confirmation emails, so we ask parents to use a personal email.
   Mirrors the server-side check in apps-script-backend.gs.
   ============================================================ */
function isSchoolEmail(s) {
  const e = String(s || '').toLowerCase().trim();
  if (!e) return false;
  return [
    /\.edu$/, /\.edu\./, /\.k12\./,
    /\.ac\.[a-z]{2,3}$/, /\.sch\.[a-z]{2,3}$/,
    /onmicrosoft\.com$/,
    /\bforsyth/i, /\bgwinnett/i,
    /\bcobb\b.*\b(k12|school|edu)/i,
    /\bfulton\b.*\b(k12|school|edu)/i,
    /\bfcps/i, /studentmail\./i
  ].some(function(p) { return p.test(e); });
}
const SCHOOL_EMAIL_MSG = 'School email addresses (.edu, .k12, onmicrosoft.com, district domains, etc.) often block our confirmation emails. Please use a personal email — Gmail, Yahoo, iCloud, or Outlook personal all work great.';

/* ============================================================
   ROBUST FETCH — timeout + retry with exponential backoff
   --------------------------------------------------------------
   Real networks misbehave: weak Wi-Fi, 4G drops, slow 3G. This
   helper wraps fetch() with:
     • 30s timeout per attempt (via AbortController)
     • Up to 3 attempts (configurable)
     • Exponential backoff: 1s, 2s, 4s between retries
     • Retries on network failures + 5xx server errors
     • Does NOT retry on 4xx (those are client errors that won't
       improve by retrying)
   Used by every Apps Script call across the app.
   ============================================================ */
async function fetchWithRetry(url, options, opts) {
  opts = opts || {};
  const maxAttempts = opts.maxAttempts || 3;
  const timeoutMs   = opts.timeoutMs   || 30000;
  const baseDelay   = opts.baseDelay   || 1000;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

      const fetchOpts = Object.assign({}, options, { signal: controller.signal });
      const res = await fetch(url, fetchOpts);
      clearTimeout(timeoutId);

      // Success or 4xx (client error — don't retry, won't get better)
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }
      // 5xx — server error, retry
      lastError = new Error('Server returned HTTP ' + res.status);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      lastError = err;
      // AbortError = timeout. TypeError = network down. Both retryable.
    }

    if (attempt < maxAttempts) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(function(r) { setTimeout(r, delay); });
    }
  }

  throw lastError || new Error('Network request failed after ' + maxAttempts + ' attempts');
}

const form = document.getElementById('volunteerForm');
const submitBtn = document.getElementById('submitBtn');
const toast = document.getElementById('toast');
const statusBanner = document.getElementById('statusBanner');
const successScreen = document.getElementById('successScreen');
const successMsg = document.getElementById('successMsg');

const QUEUE_KEY = 'pendingSubmissions';

/* ----------------------- Online/Offline status ----------------------- */
function updateOnlineStatus() {
  if (navigator.onLine) {
    statusBanner.className = 'status-banner online';
    statusBanner.textContent = '🟢 Online — submissions will sync immediately.';
    setTimeout(() => { statusBanner.style.display = 'none'; }, 3000);
    flushQueue();
  } else {
    statusBanner.className = 'status-banner offline';
    statusBanner.textContent = '🟠 Offline — submissions will be saved & synced when you reconnect.';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

/* ----------------------- Toast helper ----------------------- */
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => { toast.className = 'toast' + (isError ? ' error' : ''); }, 3500);
}

/* ============================================================
   EMAIL VERIFICATION GATE — parent email OTP
   --------------------------------------------------------------
   On page load: if a verification token already exists in
   sessionStorage, skip the gate. Otherwise: enter parent email →
   send code → enter code → unlock the form. Verified email is
   pre-filled and locked into the parentEmail field.
   ============================================================ */
(function setupVerifyGate() {
  const verifyGate = document.getElementById('verifyGate');
  const formEl = document.getElementById('volunteerForm');
  if (!verifyGate || !formEl) return;

  const sendOtpBtn       = document.getElementById('sendOtpBtn');
  const verifyOtpBtn     = document.getElementById('verifyOtpBtn');
  const resendOtpLink    = document.getElementById('resendOtpLink');
  const changeEmailLink  = document.getElementById('changeEmailLink');
  const emailInput       = document.getElementById('verifyEmailInput');
  const otpInput         = document.getElementById('otpInput');
  const verifyEmailDisp  = document.getElementById('verifyEmailDisplay');
  const verifyError      = document.getElementById('verifyError');
  const step1            = document.getElementById('verifyStep1');
  const step2            = document.getElementById('verifyStep2');

  // Restore previous session if still valid
  const savedToken = sessionStorage.getItem('gtaVerifiedToken');
  const savedEmail = sessionStorage.getItem('gtaVerifiedEmail');
  if (savedToken && savedEmail) {
    showForm(savedEmail);
    return;
  }

  function showError(msg) {
    verifyError.textContent = msg || '';
    verifyError.style.display = msg ? 'block' : 'none';
  }

  async function callBackend(action, payload) {
    const res = await fetchWithRetry(CONFIG.appsScriptUrl, {
      method: 'POST', mode: 'cors', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, payload)),
      keepalive: true   // mobile: complete OTP request even if app backgrounds
    }, { maxAttempts: 3, timeoutMs: 25000 });
    if (!res.ok) throw new Error('Network error (' + res.status + ')');
    return res.json();
  }

  async function sendCode(email) {
    showError('');
    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = 'Sending…';
    try {
      const data = await callBackend('sendOtp', { email: email });
      if (data.status !== 'ok') {
        showError(data.message || 'Could not send code.');
        return false;
      }
      verifyEmailDisp.textContent = email;
      step1.style.display = 'none';
      step2.style.display = 'block';
      otpInput.focus();
      return true;
    } catch (err) {
      showError('Network error. Please try again.');
      return false;
    } finally {
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = 'Send verification code';
    }
  }

  sendOtpBtn.addEventListener('click', () => {
    const email = (emailInput.value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      showError('Please enter a valid email address.');
      return;
    }
    if (isSchoolEmail(email)) {
      showError(SCHOOL_EMAIL_MSG);
      return;
    }
    sendCode(email);
  });

  verifyOtpBtn.addEventListener('click', async () => {
    const email = (emailInput.value || '').trim().toLowerCase();
    const code = (otpInput.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
      showError('Code must be 6 digits.');
      return;
    }
    showError('');
    verifyOtpBtn.disabled = true;
    verifyOtpBtn.textContent = 'Verifying…';
    try {
      const data = await callBackend('verifyOtp', { email: email, code: code });
      if (data.status !== 'ok') {
        showError(data.message || 'Verification failed.');
        return;
      }
      sessionStorage.setItem('gtaVerifiedToken', data.verifiedToken);
      sessionStorage.setItem('gtaVerifiedEmail', data.email);
      showForm(data.email);
    } catch (err) {
      showError('Network error. Please try again.');
    } finally {
      verifyOtpBtn.disabled = false;
      verifyOtpBtn.textContent = 'Verify code';
    }
  });

  resendOtpLink.addEventListener('click', () => {
    const email = (emailInput.value || '').trim().toLowerCase();
    if (email) sendCode(email);
  });

  changeEmailLink.addEventListener('click', () => {
    showError('');
    step2.style.display = 'none';
    step1.style.display = 'block';
    otpInput.value = '';
    emailInput.focus();
  });

  function showForm(email) {
    // Hide the gate
    verifyGate.style.display = 'none';
    // Reveal the tab bar + the default (Register) view
    const appTabs       = document.getElementById('appTabs');
    const registerView  = document.getElementById('registerView');
    if (appTabs)      appTabs.style.display = '';
    if (registerView) registerView.style.display = 'block';
    formEl.style.display = 'block';
    // Reveal chat bubble + language picker (also gated)
    const chatFab    = document.getElementById('chatFab');
    const langPicker = document.getElementById('langPicker');
    if (chatFab)    chatFab.style.display = '';
    if (langPicker) langPicker.style.display = '';

    // Pre-fill and lock the parent email field
    const parentEmailField = document.getElementById('parentEmail');
    if (parentEmailField) {
      parentEmailField.value = email;
      parentEmailField.readOnly = true;
      parentEmailField.style.background = '#fff8ec';
      parentEmailField.style.cursor = 'not-allowed';
    }
    // Add a verified badge at the top of the form
    if (!document.getElementById('verifiedBadge')) {
      const badge = document.createElement('div');
      badge.id = 'verifiedBadge';
      badge.className = 'verified-badge';
      badge.innerHTML = '✓ <strong>Parent email verified:</strong> ' + email;
      formEl.insertBefore(badge, formEl.firstChild);
    }
  }
})();

/* ============================================================
   STUDENT-VOLUNTEER TOGGLE — drives Section 1 visibility AND
   the Section 2 consent block (parent vs adult)
   ============================================================ */
function toggleStudentSection() {
  const radio = document.querySelector('input[name="isStudent"]:checked');
  const isStudent = !radio || radio.value === 'yes';

  // ---- Section 1 (Student Information) visibility ----
  const section1 = document.getElementById('studentInfoSection');
  if (section1) {
    section1.style.display = isStudent ? '' : 'none';
    // When hidden, neutralize required attributes so the form can submit
    section1.querySelectorAll('input, select, textarea').forEach(el => {
      if (!isStudent) {
        if (el.required) {
          el.dataset._wasRequired = 'true';
          el.required = false;
        }
      } else if (el.dataset._wasRequired) {
        el.required = true;
        delete el.dataset._wasRequired;
      }
    });
  }

  // ---- Section 2 title ----
  const section2Title = document.getElementById('section2Title');
  if (section2Title) {
    section2Title.textContent = isStudent
      ? '2. Parent / Guardian Consent'
      : '2. Adult Volunteer — Information & Consent';
  }

  // ---- Relationship field — only relevant for student/parent mode ----
  const relationshipField = document.getElementById('parentRelationField');
  if (relationshipField) relationshipField.style.display = isStudent ? '' : 'none';

  // ---- Parent name label adapts to context ----
  const parentNameLabel = document.getElementById('parentNameLabel');
  if (parentNameLabel) {
    parentNameLabel.innerHTML = isStudent
      ? 'Parent/Guardian Name<span class="req">*</span>'
      : 'Your Full Name<span class="req">*</span>';
  }

  // ---- Toggle parent consent vs adult consent ----
  const parentConsentField = document.getElementById('parentConsentField');
  const adultConsentField  = document.getElementById('adultConsentField');
  const parentConsent      = document.getElementById('parentConsent');
  const adultConsent       = document.getElementById('adultConsent');

  if (isStudent) {
    if (parentConsentField) parentConsentField.style.display = '';
    if (adultConsentField)  adultConsentField.style.display  = 'none';
    if (parentConsent) parentConsent.required = true;
    if (adultConsent)  { adultConsent.required = false; adultConsent.checked = false; }
  } else {
    if (parentConsentField) parentConsentField.style.display = 'none';
    if (adultConsentField)  adultConsentField.style.display  = '';
    if (parentConsent) { parentConsent.required = false; parentConsent.checked = false; }
    if (adultConsent)  adultConsent.required = true;
  }
}

/* ----------------------- Tab switching ----------------------- */
function switchView(view) {
  const views = {
    register: document.getElementById('registerView'),
    hours:    document.getElementById('hoursView'),
    learn:    document.getElementById('learnView')
  };
  const tabs = {
    register: document.getElementById('tabRegister'),
    hours:    document.getElementById('tabHours'),
    learn:    document.getElementById('tabLearn')
  };
  Object.keys(views).forEach((key) => {
    if (views[key]) views[key].style.display = (key === view) ? 'block' : 'none';
    if (tabs[key])  tabs[key].classList.toggle('active', key === view);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ----------------------- "Other" role toggle ----------------------- */
function toggleOtherRole() {
  const role = document.getElementById('activityName').value;
  const otherField = document.getElementById('otherRoleField');
  const otherInput = document.getElementById('activityNameOther');
  if (role === 'Other') {
    otherField.style.display = 'block';
    otherInput.required = true;
  } else {
    otherField.style.display = 'none';
    otherInput.required = false;
    otherInput.value = '';
  }
}

/* ----------------------- Form submission ----------------------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    showToast('Please fill all required fields.', true);
    return;
  }

  // Collect all form data into an object
  const formData = new FormData(form);
  const data = {};
  formData.forEach((value, key) => { data[key] = value; });

  // If role is "Other", combine into activityName so the sheet/PDF stays consistent
  if (data.activityName === 'Other' && data.activityNameOther) {
    data.activityName = 'Other: ' + data.activityNameOther;
  }
  delete data.activityNameOther;

  // Reject school email addresses (they block our confirmation emails)
  if (isSchoolEmail(data.studentEmail) || isSchoolEmail(data.parentEmail)) {
    showToast(SCHOOL_EMAIL_MSG, true);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Form & Generate Report';
    return;
  }

  // Attach the parent-email verification token for server-side validation
  data._verifiedToken = sessionStorage.getItem('gtaVerifiedToken') || '';

  // Note whether section 1 was filled (for the sheet)
  data._isStudent = (document.querySelector('input[name="isStudent"]:checked') || {}).value || 'yes';

  // Add metadata
  data.submissionId = generateId();
  data.submittedAt = new Date().toISOString();
  data.submittedAtReadable = new Date().toLocaleString();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Generating report...';

  try {
    // 1. Generate and download PDF report
    generatePDFReport(data);

    // 2. Try to sync to Google Sheets (or queue if offline)
    let didSync = false;
    let serverErrorMsg = '';
    let serverErrorCode = '';

    if (navigator.onLine && CONFIG.appsScriptUrl && !CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) {
      try {
        await syncToSheet(data);
        didSync = true;
        successMsg.textContent = '✅ Registration confirmed. A confirmation email has been sent to your registered email (parent CC\'d). Your PDF copy was also downloaded. The GTA team will be in touch with event details.';
      } catch (err) {
        console.error('Sync error:', err);
        serverErrorMsg = err.serverMessage || err.message || 'Unknown error';
        serverErrorCode = err.code || '';

        // Server returned an explicit error (NOT a network problem) → surface to user, do NOT pretend success
        if (err.code) {
          // Special handling for verification-expired: clear the verification and prompt re-verify
          if (err.code === 'verification_expired') {
            try {
              sessionStorage.removeItem('gtaVerifiedToken');
              sessionStorage.removeItem('gtaVerifiedEmail');
            } catch (e) {}
            showToast('Your parent-email verification expired. The page will reload so you can verify again.', true);
            setTimeout(() => location.reload(), 3500);
            return;
          }
          // Any other server-reported error: show the message, don't show success screen
          showToast('❌ ' + serverErrorMsg, true);
          return;
        }

        // No code → likely a true network failure. Queue for offline retry.
        queueSubmission(data);
        successMsg.textContent = '⚠️ Registration saved on your device. We could not reach GTA right now — it will be sent automatically once your connection is stable.';
      }
    } else if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) {
      successMsg.textContent = '✅ Your copy was downloaded. (GTA sync is not yet configured — please email a copy to the GTA team.)';
    } else {
      queueSubmission(data);
      successMsg.textContent = '📥 Registration saved on your device. It will be sent to the GTA team automatically once you are back online.';
    }

    // Show success screen (unless we already returned early on a server error)
    form.style.display = 'none';
    successScreen.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error(err);
    showToast('Something went wrong. Please try again.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Form & Generate Report';
  }
});

/* ----------------------- PDF Report Generator ----------------------- */
function generatePDFReport(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 50;

  // Header band
  doc.setFillColor(13, 110, 253);
  doc.rect(0, 0, pageWidth, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Global Telangana Association', pageWidth / 2, 28, { align: 'center' });
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text('GTA International Fest — Volunteer Registration', pageWidth / 2, 47, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Submitted: ' + d.submittedAtReadable, pageWidth / 2, 62, { align: 'center' });

  y = 100;
  doc.setTextColor(31, 41, 55);

  function section(title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(10, 88, 202);
    doc.text(title, 40, y);
    doc.setDrawColor(13, 110, 253);
    doc.setLineWidth(1);
    doc.line(40, y + 4, pageWidth - 40, y + 4);
    y += 22;
    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
  }

  function kv(label, value) {
    if (y > 720) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold');
    doc.text(label + ':', 50, y);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(value || '—', pageWidth - 220);
    doc.text(lines, 200, y);
    y += Math.max(16, lines.length * 14);
  }

  // STUDENT INFO
  section('1. Student Information');
  kv('Full Name', `${d.firstName} ${d.lastName}`);
  kv('Date of Birth', d.dob);
  kv('Grade Level', d.gradeLevel);
  kv('School', d.schoolName);
  kv('Student ID', d.studentId);
  kv('Email', d.studentEmail);
  kv('Phone', d.studentPhone);
  y += 8;

  // PARENT
  section('2. Parent / Guardian Consent');
  kv('Parent/Guardian', `${d.parentName} (${d.parentRelation || 'Relation not specified'})`);
  kv('Email', d.parentEmail);
  kv('Phone', d.parentPhone);
  kv('Emergency Contact', `${d.emergencyName} — ${d.emergencyPhone}`);
  kv('Consent Given', d.parentConsent ? 'YES — confirmed by parent/guardian' : 'NO');
  y += 8;

  // ACTIVITY
  section('3. Volunteer Activity');
  kv('Activity', d.activityName);
  kv('Organization', d.organization);
  kv('Date', d.activityDate);
  kv('Hours', d.hours);
  kv('Supervisor', `${d.supervisorName} — ${d.supervisorContact}`);
  kv('Description', d.description);
  y += 8;

  // MEDICAL
  section('4. Medical & Allergy Info');
  kv('Allergies', d.allergies);
  kv('Conditions', d.medicalConditions);
  kv('Medications', d.medications);

  // Footer
  if (y > 720) { doc.addPage(); y = 50; }
  y = Math.max(y, 740);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Submission ID: ${d.submissionId}`, 40, y);
  doc.text('Global Telangana Association — GTA International Fest', pageWidth - 40, y, { align: 'right' });

  // Filename: LastName_FirstName_Activity_YYYY-MM-DD.pdf
  const safeName = (s) => (s || '').replace(/[^a-z0-9]/gi, '');
  const dateStr = (d.activityDate || new Date().toISOString().slice(0, 10));
  const filename = `${safeName(d.lastName)}_${safeName(d.firstName)}_${safeName(d.activityName)}_${dateStr}.pdf`;

  doc.save(filename);
}

/* ----------------------- Google Sheets sync ----------------------- */
async function syncToSheet(data) {
  // Apps Script web apps require text/plain (no preflight) for cross-origin POST.
  // fetchWithRetry handles timeouts, transient failures, and weak networks automatically.
  const res = await fetchWithRetry(CONFIG.appsScriptUrl, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data),
    keepalive: true   // mobile: finish request even if user closes the page mid-submit
  }, { maxAttempts: 3, timeoutMs: 30000 });
  if (!res.ok) throw new Error('Sync failed: HTTP ' + res.status);

  // Apps Script returns HTTP 200 even on errors — actual success/error is in
  // the response BODY's status field. Don't treat HTTP 200 as success blindly.
  let body = {};
  try { body = await res.json(); } catch (e) {}

  if (body.status === 'error') {
    const err = new Error(body.message || 'Server returned an error');
    err.code = body.code || 'server_error';   // e.g., 'verification_expired'
    err.serverMessage = body.message || '';
    throw err;
  }
  return body;
}

/* ----------------------- Offline queue (in-memory + IndexedDB) ----------------------- */
// Simple IndexedDB wrapper so queued submissions survive reload/offline
const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open('volunteerAppDB', 1);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('queue')) {
      db.createObjectStore('queue', { keyPath: 'submissionId' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function queueSubmission(data) {
  try {
    const db = await dbPromise;
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(data);
    showToast('Saved locally — will sync when online.', false);
  } catch (e) {
    console.error('Queue failed:', e);
  }
}

async function flushQueue() {
  if (!navigator.onLine) return;
  if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) return;
  try {
    const db = await dbPromise;
    const tx = db.transaction('queue', 'readonly');
    const all = await new Promise((res) => {
      const r = tx.objectStore('queue').getAll();
      r.onsuccess = () => res(r.result || []);
    });
    if (all.length === 0) return;

    let synced = 0;
    for (const entry of all) {
      try {
        await syncToSheet(entry);
        const tx2 = db.transaction('queue', 'readwrite');
        tx2.objectStore('queue').delete(entry.submissionId);
        synced++;
      } catch (e) {
        // leave in queue — retry next time
      }
    }
    if (synced > 0) showToast(`✓ Synced ${synced} pending submission(s).`);
  } catch (e) {
    console.error('Flush failed:', e);
  }
}

/* ----------------------- Helpers ----------------------- */
function generateId() {
  return 'VOL-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function resetForm() {
  form.reset();
  form.style.display = 'block';
  successScreen.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   HOURS-COMPLETION SUBMISSION
   - Student returns after volunteering and logs their actual hours
   - Apps Script finds their original registration row by email + last name
     and updates "Actual Hours Completed" + "Hours Submitted At" + "Notes"
   - A PDF "hours receipt" is generated for their community-service credit
   ============================================================ */
const hoursForm = document.getElementById('hoursForm');
const hoursSubmitBtn = document.getElementById('hoursSubmitBtn');
const hoursSuccessScreen = document.getElementById('hoursSuccessScreen');
const hoursSuccessMsg = document.getElementById('hoursSuccessMsg');

hoursForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!hoursForm.checkValidity()) {
    hoursForm.reportValidity();
    showToast('Please fill all required fields.', true);
    return;
  }

  const fd = new FormData(hoursForm);
  const payload = { action: 'submitHours' };
  fd.forEach((v, k) => { payload[k] = v; });
  payload.submittedAt = new Date().toISOString();
  payload.submittedAtReadable = new Date().toLocaleString();
  payload.receiptId = 'HRS-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();

  hoursSubmitBtn.disabled = true;
  hoursSubmitBtn.textContent = 'Submitting…';

  try {
    if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) {
      throw new Error('GTA backend not configured. Please ask the GTA admin.');
    }
    if (!navigator.onLine) {
      throw new Error('You appear to be offline. Try again when you have a connection.');
    }

    const res = await fetchWithRetry(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      keepalive: true   // mobile: don't lose hours submission if user switches apps
    }, { maxAttempts: 3, timeoutMs: 30000 });

    const result = await res.json().catch(() => ({}));

    if (result.status === 'ok') {
      // Use the first name returned from the sheet (so PDF can personalize)
      payload.firstName = result.firstName || '';
      payload.activityName = result.activityName || '';
      payload.appreciation = result.appreciation || '';
      // Verification metadata from the QR-scan check-in/out flow
      payload.verification = result.verification || null;

      // Generate the personalized certificate PDF and ship its base64 to the
      // backend so it can be attached to the confirmation email (sent to the
      // volunteer + CC'd to the parent).
      try {
        const pdfResult = await generateHoursReceiptPDF(payload);
        if (pdfResult && pdfResult.base64) {
          // Fire-and-forget: send the certificate as a second backend call so
          // the success UI doesn't wait on the email round-trip. If this fails,
          // the volunteer still has the downloaded PDF — they're not blocked.
          fetchWithRetry(CONFIG.appsScriptUrl, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'emailCertificate',
              email: payload.email,
              lastName: payload.lastName,
              receiptId: payload.receiptId,
              pdfFilename: pdfResult.filename,
              pdfBase64: pdfResult.base64
            }),
            keepalive: true
          }, { maxAttempts: 2, timeoutMs: 30000 }).catch(function(e) {
            console.warn('Certificate email send failed (volunteer still has PDF):', e);
          });
        }
      } catch (pdfErr) {
        console.warn('Certificate PDF generation failed:', pdfErr);
      }

      // Build a verification badge for the success screen
      // (small inline HTML-escape so we can safely interpolate into innerHTML)
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const v = result.verification;
      let badge = '';
      if (v && v.verified) {
        badge = `<div style="margin-top:12px;padding:12px;background:#d1fae5;border-left:4px solid #059669;border-radius:6px;color:#065f46;font-size:14px">
          <strong>✓ Verified by GTA event admin</strong><br>
          Checked in: ${esc(v.checkedInAt)}<br>
          Checked out: ${esc(v.checkedOutAt)}<br>
          On-site duration: <strong>${esc(v.verifiedDuration)} hrs</strong>
        </div>`;
      }
      hoursSuccessMsg.innerHTML = `Thanks${payload.firstName ? ' ' + esc(payload.firstName) : ''}! Your <strong>${esc(payload.hoursCompleted)} hours</strong> have been logged in GTA's records. A confirmation email has been sent to you, and a PDF receipt has been downloaded for your community-service credit.${badge}`;
      hoursForm.style.display = 'none';
      hoursSuccessScreen.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Specific verification-failure paths (clearer guidance than generic error)
      if (result.code === 'not_checked_in' || result.code === 'not_checked_out') {
        showToast(result.message, true);
        // Highlight the hours field so the user sees the message is about the event flow
      } else if (result.code === 'over_claimed') {
        showToast(result.message, true);
        // Pre-fill the verified duration so the user can correct & resubmit
        const hoursInput = hoursForm.querySelector('[name="hoursCompleted"]');
        if (hoursInput && result.verifiedDuration) {
          hoursInput.value = result.verifiedDuration;
        }
      } else {
        const msg = result.message || "We couldn't find a registration matching that email and last name. Did you register first?";
        showToast(msg, true);
      }
    }
  } catch (err) {
    showToast(err.message || 'Could not submit hours. Try again.', true);
    console.error(err);
  } finally {
    hoursSubmitBtn.disabled = false;
    hoursSubmitBtn.textContent = 'Submit Hours & Get Receipt';
  }
});

function resetHoursForm() {
  hoursForm.reset();
  hoursForm.style.display = 'block';
  hoursSuccessScreen.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   CERT TEMPLATE LOADER
   --------------------------------------------------------------
   We render the official GTA certificate by overlaying the
   volunteer's name + hours on top of the pre-printed template
   image (cert-template.png). The image is loaded once on first
   use and cached as a data URL so it can be embedded in jsPDF
   AND in the server-side email (via base64 in the payload).
   If the image can't be loaded (e.g. user hasn't placed
   cert-template.png in C:\Volforum yet), we fall back to a
   plain branded receipt so the flow never breaks.
   ============================================================ */
let _certTemplateDataUrl = null;
let _certTemplateDims = null;
function loadCertTemplate() {
  if (_certTemplateDataUrl) return Promise.resolve({ dataUrl: _certTemplateDataUrl, dims: _certTemplateDims });
  return new Promise(function(resolve) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        _certTemplateDataUrl = canvas.toDataURL('image/png');
        _certTemplateDims = { w: img.naturalWidth, h: img.naturalHeight };
        resolve({ dataUrl: _certTemplateDataUrl, dims: _certTemplateDims });
      } catch (e) {
        // CORS tainted canvas — can't extract; fall back gracefully
        resolve({ dataUrl: null, dims: null });
      }
    };
    img.onerror = function() { resolve({ dataUrl: null, dims: null }); };
    img.src = 'cert-template.png';
  });
}

// Preload the cert template as soon as the script runs so it's ready by checkout time.
// Wrapped in try/catch because the file may legitimately not exist on first deploy.
try { loadCertTemplate(); } catch (e) {}

/**
 * Generate the personalized PDF certificate.
 * Returns a Promise resolving to { blob, base64 } so the caller can:
 *   - trigger a browser download (PDF receipt for the volunteer's school)
 *   - send the base64 to the backend so it can be emailed as an attachment
 */
function generateHoursReceiptPDF(d) {
  return loadCertTemplate().then(function(tpl) {
    if (tpl.dataUrl && tpl.dims) {
      return renderTemplatedCert(d, tpl);
    }
    // Fallback: original branded receipt (used until cert-template.png is deployed)
    return renderFallbackReceipt(d);
  });
}

/* ---------- Templated certificate (image background + overlay) ---------- */
function renderTemplatedCert(d, tpl) {
  const { jsPDF } = window.jspdf;
  // Match the cert template's aspect ratio so the image fills the page edge-to-edge
  const aspectRatio = tpl.dims.w / tpl.dims.h;
  const pdfWidth = 800;                   // pt
  const pdfHeight = pdfWidth / aspectRatio;
  const doc = new jsPDF({
    unit: 'pt',
    format: [pdfWidth, pdfHeight],
    orientation: aspectRatio > 1 ? 'landscape' : 'portrait'
  });

  // Background = the cert template image
  doc.addImage(tpl.dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);

  // Overlay name on the first blank line ("This is to certify that ___ has completed")
  // Coordinates are tuned to the template the user provided. If alignment looks off
  // after a real test, nudge the percent values below.
  const fullName = ((d.firstName || '') + ' ' + (d.lastName || '')).trim();
  const hoursStr = String(d.hoursCompleted || '').trim();

  // Name — handwriting-style, centered on the first blank
  doc.setFont('times', 'italic');
  doc.setFontSize(22);
  doc.setTextColor(31, 41, 55);
  doc.text(fullName, pdfWidth * 0.47, pdfHeight * 0.555, { align: 'center' });

  // Hours — bold large number on the second-line blank, left side
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(120, 53, 15);          // dark amber to match the brand
  doc.text(hoursStr, pdfWidth * 0.14, pdfHeight * 0.655, { align: 'center' });

  // Small footer line: verification metadata (printed below the signatures
  // area so it doesn't interfere with the cert artwork)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  const ver = d.verification;
  const footer = ver && ver.verified
    ? `Verified by GTA: checked in ${ver.checkedInAt} → checked out ${ver.checkedOutAt} (${ver.verifiedDuration} hrs on-site) · Receipt ID ${d.receiptId}`
    : `Receipt ID ${d.receiptId} · Issued ${d.submittedAtReadable}`;
  doc.text(footer, pdfWidth / 2, pdfHeight - 8, { align: 'center' });

  return finalizePdf(doc, d);
}

/* ---------- Fallback receipt (used when cert-template.png is missing) ---------- */
function renderFallbackReceipt(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(13, 110, 253);
  doc.rect(0, 0, pageWidth, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Global Telangana Association', pageWidth / 2, 28, { align: 'center' });
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text('GTA International Fest — Volunteer Hours Receipt', pageWidth / 2, 47, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Receipt issued: ' + d.submittedAtReadable, pageWidth / 2, 62, { align: 'center' });

  // Body
  doc.setTextColor(31, 41, 55);
  let y = 110;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('This certifies that', pageWidth / 2, y, { align: 'center' });
  y += 30;

  doc.setFontSize(22);
  doc.setTextColor(10, 88, 202);
  const fullName = d.firstName ? `${d.firstName} ${d.lastName}` : d.lastName;
  doc.text(fullName, pageWidth / 2, y, { align: 'center' });
  y += 30;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(31, 41, 55);
  doc.text('volunteered the following service hours:', pageWidth / 2, y, { align: 'center' });
  y += 50;

  // Big hours number
  doc.setFontSize(48);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(25, 135, 84);
  doc.text(`${d.hoursCompleted} hours`, pageWidth / 2, y, { align: 'center' });
  y += 30;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  if (d.dateVolunteered) {
    doc.text(`Date(s) volunteered: ${d.dateVolunteered}`, pageWidth / 2, y, { align: 'center' });
    y += 18;
  }
  if (d.activityName) {
    doc.text(`Volunteer role: ${d.activityName}`, pageWidth / 2, y, { align: 'center' });
    y += 18;
  }
  y += 10;

  // ----- Verification badge (green if QR-verified, amber if not) -----
  // This is the key trust signal for the receiving school/teacher reviewing the hours.
  const ver = d.verification;
  const isVerified = ver && ver.verified;
  const badgeText = isVerified ? 'VERIFIED BY GTA EVENT ADMIN' : 'PENDING VERIFICATION';
  const badgeW = 280, badgeH = 32;
  const badgeX = (pageWidth - badgeW) / 2;
  if (isVerified) {
    doc.setFillColor(209, 250, 229);            // green-100
    doc.setDrawColor(5, 150, 105);              // emerald-600
  } else {
    doc.setFillColor(254, 243, 199);            // amber-100
    doc.setDrawColor(217, 119, 6);              // amber-600
  }
  doc.setLineWidth(1.4);
  doc.roundedRect(badgeX, y, badgeW, badgeH, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(isVerified ? 6 : 146, isVerified ? 95 : 64, isVerified ? 70 : 14);
  doc.text(badgeText, pageWidth / 2, y + 20, { align: 'center' });
  y += badgeH + 8;
  if (isVerified && ver.checkedInAt && ver.checkedOutAt) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(`Check-in ${ver.checkedInAt}  →  Check-out ${ver.checkedOutAt}  (${ver.verifiedDuration} hrs on-site)`, pageWidth / 2, y, { align: 'center' });
    y += 16;
  }
  y += 6;

  // AI-generated personalized appreciation (centered framed quote)
  if (d.appreciation && d.appreciation.trim()) {
    const appreciationText = '"' + d.appreciation.replace(/\s+/g, ' ').trim() + '"';
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    const appLines = doc.splitTextToSize(appreciationText, pageWidth - 160);
    const blockHeight = appLines.length * 15 + 32;
    // Cream background with gold left border
    doc.setFillColor(255, 248, 236);
    doc.roundedRect(60, y, pageWidth - 120, blockHeight, 6, 6, 'F');
    doc.setFillColor(212, 164, 55);
    doc.rect(60, y, 4, blockHeight, 'F');
    doc.setTextColor(120, 53, 15);
    doc.text(appLines, pageWidth / 2, y + 18, { align: 'center' });
    // AI attribution
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(146, 116, 27);
    doc.text('Personalized appreciation, written by AI based on your service.', pageWidth / 2, y + blockHeight - 8, { align: 'center' });
    y += blockHeight + 18;
  }

  // Notes
  if (d.notes && d.notes.trim()) {
    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Volunteer notes:', 60, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(d.notes, pageWidth - 120);
    doc.text(lines, 60, y);
    y += lines.length * 14 + 10;
  }

  // Verification box
  y = Math.max(y + 30, 560);
  doc.setDrawColor(13, 110, 253);
  doc.setLineWidth(1);
  doc.roundedRect(60, y, pageWidth - 120, 80, 8, 8);
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('For schools accepting community-service credit:', 75, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`This receipt is auto-generated by the GTA Volunteer App and is logged in GTA's master`, 75, y + 40);
  doc.text(`records. To verify, contact the Global Telangana Association volunteer coordinator.`, 75, y + 54);
  doc.text(`Receipt ID: ${d.receiptId}`, 75, y + 70);

  return finalizePdf(doc, d);
}

/* ---------- Shared PDF finalizer: triggers download + returns base64 ---------- */
function finalizePdf(doc, d) {
  const safeName = (s) => (s || '').replace(/[^a-z0-9]/gi, '');
  const filename = `GTA_Volunteer_Certificate_${safeName(d.lastName)}_${safeName(d.firstName) || 'Receipt'}.pdf`;
  // Trigger browser download for the volunteer's local copy
  try { doc.save(filename); } catch (e) { console.warn('PDF download trigger failed:', e); }
  // Also return the PDF as a base64 string (sans the data-URL prefix) so the
  // backend can attach it to the confirmation email. jsPDF's datauristring
  // is the easiest portable way to get this.
  let base64 = '';
  try {
    const dataUri = doc.output('datauristring');
    base64 = dataUri.split(',')[1] || '';
  } catch (e) {
    console.warn('PDF base64 extract failed:', e);
  }
  return { filename: filename, base64: base64 };
}

/* ============================================================
   PERIODIC QUEUE FLUSH — belt-and-suspenders for flaky networks
   --------------------------------------------------------------
   The 'online' event fires when the device transitions from
   offline → online. But on intermittent 4G/5G or weak Wi-Fi, the
   browser may not always fire the event reliably. So in addition,
   we poll every 30 seconds: if there are queued submissions and
   we're online, try to flush them.
   ============================================================ */
setInterval(function() {
  if (navigator.onLine) {
    flushQueue().catch(function(e) { console.warn('Periodic flush skipped:', e); });
  }
}, 30000);

/* ----------------------- Service worker (PWA) ----------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.log('Service worker registration skipped:', err);
    });
  });
}
