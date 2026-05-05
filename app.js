/* ============================================================
   Student Volunteer Form — App Logic
   - Collects & validates form data
   - Generates a PDF report and downloads it to the device
   - Syncs the entry to a Google Sheet via Apps Script web app
   - Queues submissions when offline; auto-resyncs when back online
   ============================================================ */

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
    const res = await fetch(CONFIG.appsScriptUrl, {
      method: 'POST', mode: 'cors', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, payload))
    });
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
   STUDENT-VOLUNTEER TOGGLE — show/hide section 1
   ============================================================ */
function toggleStudentSection() {
  const isStudent = document.querySelector('input[name="isStudent"]:checked').value === 'yes';
  const section = document.getElementById('studentInfoSection');
  if (!section) return;
  section.style.display = isStudent ? '' : 'none';
  // When hidden, neutralize required attributes so the form can submit
  section.querySelectorAll('input, select, textarea').forEach(el => {
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
    if (navigator.onLine && CONFIG.appsScriptUrl && !CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) {
      try {
        await syncToSheet(data);
        successMsg.textContent = '✅ Registration confirmed. A confirmation email has been sent to your registered email (and your parent has been CC\'d). Your PDF copy was also downloaded. The GTA team will be in touch with event details.';
      } catch (err) {
        queueSubmission(data);
        successMsg.textContent = '⚠️ Registration saved on your device. We could not reach GTA right now — it will be sent automatically once your connection is stable.';
      }
    } else if (!CONFIG.appsScriptUrl || CONFIG.appsScriptUrl.includes('YOUR_APPS_SCRIPT_URL')) {
      successMsg.textContent = '✅ Your copy was downloaded. (GTA sync is not yet configured — please email a copy to the GTA team.)';
    } else {
      queueSubmission(data);
      successMsg.textContent = '📥 Registration saved on your device. It will be sent to the GTA team automatically once you are back online.';
    }

    // Show success screen
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
  // Apps Script web apps require text/plain (no preflight) for cross-origin POST
  const res = await fetch(CONFIG.appsScriptUrl, {
    method: 'POST',
    mode: 'cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return res.json().catch(() => ({}));
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

    const res = await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const result = await res.json().catch(() => ({}));

    if (result.status === 'ok') {
      // Use the first name returned from the sheet (so PDF can personalize)
      payload.firstName = result.firstName || '';
      payload.activityName = result.activityName || '';
      payload.appreciation = result.appreciation || '';
      generateHoursReceiptPDF(payload);
      hoursSuccessMsg.textContent = `Thanks${payload.firstName ? ' ' + payload.firstName : ''}! Your ${payload.hoursCompleted} hours have been logged in GTA's records. A confirmation email has been sent to you, and a PDF receipt has been downloaded for your community-service credit.`;
      hoursForm.style.display = 'none';
      hoursSuccessScreen.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const msg = result.message || "We couldn't find a registration matching that email and last name. Did you register first?";
      showToast(msg, true);
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

function generateHoursReceiptPDF(d) {
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

  const safeName = (s) => (s || '').replace(/[^a-z0-9]/gi, '');
  doc.save(`GTA_Volunteer_Hours_${safeName(d.lastName)}_${safeName(d.firstName) || 'Receipt'}.pdf`);
}

/* ----------------------- Service worker (PWA) ----------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.log('Service worker registration skipped:', err);
    });
  });
}
