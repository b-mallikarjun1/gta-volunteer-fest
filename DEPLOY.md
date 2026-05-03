# GTA Volunteer App — Fresh Deployment Guide

This is the **start-from-scratch** guide. Follow it in order, top to bottom — no skipping. At the end you'll have:

- A live volunteer registration form for students
- A Google Sheet auto-collecting every registration
- Confirmation emails to students (CC parents)
- An admin dashboard showing live stats
- An AI chat assistant for student questions
- A printable QR poster GTA can email to schools

Total time: **~25 minutes**. No coding required.

## Mental model

Think of this like opening a new restaurant:

| Restaurant piece | What it is here |
|---|---|
| The address (storefront) | Your hosted app URL — where students go |
| The kitchen | Apps Script — receives orders (form data), cooks them (saves + emails) |
| The pantry | Google Sheet — where every order is filed |
| The waiter | The form itself — collects student info |
| The receptionist | Confirmation emails — greets every guest |
| The manager's office | Admin dashboard — see everything at a glance |
| The flyer in the window | QR poster — gets people to come in |

You'll set up these pieces in order: **pantry → kitchen → recipes → waiter → flyer**.

---

## Stage 1 — Create the GTA Google Sheet (3 min)

1. Sign into Google with the **GTA account** (or whichever account will own the volunteer records — ideally a dedicated GTA Gmail like `gta.volunteers@gmail.com`).
2. Go to [sheets.google.com](https://sheets.google.com) and click **+ Blank**.
3. Rename it: **"GTA International Fest — Volunteer Registrations"**.
4. Leave it open — you'll need it in the next stage.

That's it for the pantry. No columns to set up — the script will create them automatically.

---

## Stage 2 — Create the Apps Script backend (5 min)

This is the brain that receives form submissions, files them in the sheet, and sends confirmation emails.

1. In the Sheet you just created, click menu: **Extensions → Apps Script**.
2. A new tab opens with a code editor and some default `function myFunction()` code.
3. **Select all that default code (Ctrl+A) and delete it.**
4. Open `C:\Volforum\apps-script-backend.gs` in Notepad.
5. Select all (Ctrl+A) → copy (Ctrl+C).
6. Click into the empty Apps Script editor → paste (Ctrl+V).
7. Click the **disk icon (💾)** to save. When prompted, name the project: **"GTA Volunteer Backend"**.

Don't deploy yet — first you need to configure two things at the top of the script.

---

## Stage 3 — Configure the script (3 min)

Near the top of the code you just pasted, find these two blocks. Replace the placeholder values:

### 3a. Set a strong admin PIN

```js
const ADMIN_PIN = 'CHANGE-ME-12345';
```

Change `CHANGE-ME-12345` to a strong PIN of your choice — 8+ characters, mix of letters and numbers. Example: `'GTA2026Fest!'`

This PIN is what GTA admins will type to open the dashboard. **Don't share it publicly** — it's the only thing protecting your volunteer list. Write it down somewhere safe.

### 3b. Set the GTA contact details

```js
const GTA_CONFIG = {
  senderName: 'Global Telangana Association',
  contactEmail: 'volunteers@gta.example.org',
  eventDate: 'TBD — the GTA team will email you with the exact date',
  eventWebsiteUrl: '',
  sendConfirmationEmails: true
};
```

Update each line:

- **`contactEmail`** → the real GTA volunteer-coordinator email (replies to confirmation emails go here)
- **`eventDate`** → the actual event date, if known. Otherwise leave the placeholder.
- **`eventWebsiteUrl`** → optional — your event page URL, e.g., `'https://gta-fest.example.org'`
- **`sendConfirmationEmails`** → keep as `true` (set to `false` only if you want to disable emails)

Click **Save (💾)** again.

---

## Stage 4 — Deploy the Apps Script as a web app (3 min)

Now the kitchen needs to open for orders.

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description**: `GTA Volunteer Form Backend`
   - **Execute as**: `Me` (the GTA admin)
   - **Who has access**: **Anyone** ← *important — without this, students' phones can't submit*
4. Click **Deploy**.
5. Google asks you to authorize. Click **Authorize access**.
6. Pick your GTA Google account.
7. You'll see a scary warning: *"Google hasn't verified this app."* This is normal for personal scripts — click **Advanced → Go to GTA Volunteer Backend (unsafe)**.
8. Click **Allow** to grant the script permission to (a) edit the sheet and (b) send emails on your behalf.
9. You'll see a "Deployment successfully updated" screen with a **Web app URL** ending in `/exec`. **Copy that URL.**

⚠️ Keep this URL handy — you'll paste it into `config.js` in the next stage.

---

## Stage 5 — Wire the URL into config.js (1 min)

1. Open `C:\Volforum\config.js` in Notepad.
2. Find this line:
   ```js
   appsScriptUrl: 'https://script.google.com/macros/s/.../exec',
   ```
3. Replace what's between the quotes with your URL from Stage 4. Make sure to keep the quotes and the trailing comma.
4. Save the file.

Your `config.js` should look something like:
```js
const CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycby.../exec',
  groqApiKey: 'YOUR_GROQ_KEY_HERE',
  schoolDisplayName: 'Our School'
};
```

---

## Stage 6 — (Optional) Add the AI chat assistant (3 min)

Skip this if you only want the built-in FAQ chat (it's already enabled, no setup needed).

To upgrade the chat to a real conversational AI:

1. Go to [console.groq.com/keys](https://console.groq.com/keys) and sign up (free, no credit card).
2. Click **Create API Key**, name it "GTA Volunteer App", copy the key.
3. Open `config.js`. Replace `'YOUR_GROQ_KEY_HERE'` with your key (keep the quotes).
4. Save.

Now the chat answers any open-ended question students ask — "Can my friend and I volunteer together?", "Will there be food at the event?" — using Llama 3 via Groq's free tier.

---

## Stage 7 — Get the app online (5 min)

The form needs to live at a public URL so students can scan a QR or click a link. Pick **one** of these:

### Option A — Netlify Drop (fastest, no account needed first)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. **Drag the entire `C:\Volforum` folder** onto the page.
3. After ~10 seconds, you get a public URL like `https://random-name-12345.netlify.app/`.
4. (Optional) sign up for a free Netlify account to keep the URL permanently and rename it to something nicer.

### Option B — GitHub Pages (free, permanent)

1. Sign in to [github.com](https://github.com) (create an account if needed — use the GTA Gmail).
2. Click **+ → New repository**. Name it `gta-volunteer-fest`. Make it Public. Click **Create**.
3. On the empty repo page, click **uploading an existing file**.
4. Drag all 16 files from `C:\Volforum` into the upload area. (Don't drag the folder itself — drag the *files inside*.)
5. Scroll down → click **Commit changes**.
6. Go to **Settings (top of repo) → Pages (left sidebar)**.
7. Under "Branch", select `main` → folder `/ (root)` → click **Save**.
8. Wait ~1 minute. Refresh. You'll see: *"Your site is live at `https://YOUR-USERNAME.github.io/gta-volunteer-fest/`"*. Copy that URL.

### Option C — Just run locally on the GTA admin's laptop

If you don't need a public URL right now (e.g., for demo or single-laptop event-day registration):

1. Make sure Python is installed (see `INSTALL.md` for steps).
2. Double-click **`start-app.bat`** in `C:\Volforum`.
3. Browser auto-opens to `http://localhost:8080`. The form is live on your computer.

For phone testing, open `http://[your-LAN-IP]:8080/local-qr.html` (the batch file prints your LAN IP at the top of the console).

---

## Stage 8 — Test end-to-end (5 min)

Now verify every piece is working.

### Test 1: Registration flow
1. Open your app URL (from Stage 7).
2. You should see: *"Global Telangana Association · GTA International Fest"* header, two tabs (📝 Register and ⏱️ Submit Hours), and a blue chat bubble bottom-right.
3. Fill out the form with **your own email and last name** (so emails come to you).
4. Click **Submit Form & Generate Report**.
5. ✅ A PDF receipt should download.
6. ✅ Within 60 seconds, a **confirmation email** should arrive in your inbox.
7. ✅ Open the GTA Google Sheet — your test registration should be there as a new row.

### Test 2: Hours-completion flow
1. Back at the form, click the **⏱️ Submit Hours** tab.
2. Enter the same email and last name from Test 1, plus e.g. `4` hours.
3. Click **Submit Hours & Get Receipt**.
4. ✅ A hours-receipt PDF should download.
5. ✅ A thank-you email should arrive.
6. ✅ The Google Sheet row should now have hours filled in and the row should turn **green**.

### Test 3: Admin dashboard
1. Open `https://your-app-url/admin.html` in a new tab (e.g., `https://your-site.netlify.app/admin.html`).
2. The blue lock screen appears.
3. Type the **admin PIN** you set in Stage 3a.
4. ✅ Dashboard loads showing: *1 Registered, 1 Completed, 0 Pending, 4 Hours Pledged, 4 Hours Completed*.
5. ✅ Charts and tables show your test data.

### Test 4: Chat assistant
1. On the form page, click the blue 💬 bubble bottom-right.
2. ✅ Greeting message appears.
3. Type a question like *"What roles are available?"*
4. ✅ You get an answer (from FAQ if no Groq key set, from Llama 3 if Groq key set).

If all 4 tests pass — **you're deployed**. 🎉

---

## Stage 9 — Print/email the QR poster for schools (3 min)

This is the flyer that goes in the restaurant window.

1. Open `https://your-app-url/qr-poster.html` in a browser. (Or open the local file `C:\Volforum\qr-poster.html`.)
2. Paste your app URL into the box at the top (e.g., `https://your-site.netlify.app/`).
3. Click **Update Poster**.
4. Click **Print Poster** (or save as PDF using Print → Save as PDF).
5. Email the PDF to partner schools, or print and post in school hallways/libraries.

---

## You're live — what to share with whom

| Audience | URL | What to do with it |
|---|---|---|
| **Students & parents** | `https://your-app-url/` | Share the link or QR poster. They click → fill form → done. |
| **Schools** | The QR poster from Stage 9 | Schools post it in hallways, include in newsletters. |
| **GTA admin team** | `https://your-app-url/admin.html` + the admin PIN | Bookmark for live stats. PIN goes in a private channel. |
| **GTA volunteer coordinator** | The Google Sheet | Open whenever. Filter, export, contact anyone in the "Pending" list. |

---

## What happens behind the scenes

When a student hits Submit:

1. **The browser** generates a PDF receipt and downloads it to their device.
2. **The browser** sends the form data to your Apps Script URL.
3. **Apps Script** appends a new row to the GTA Google Sheet.
4. **Apps Script** sends a confirmation email from your GTA Gmail to the student (CCing the parent).
5. **Apps Script** returns success to the browser, which shows the thank-you screen.

When a student logs hours afterward:

1. **The browser** sends the email + last name to Apps Script.
2. **Apps Script** searches the sheet for the matching row.
3. **Apps Script** updates the row with hours, timestamp, notes — and turns the row green.
4. **Apps Script** sends a thank-you email.
5. **The browser** generates a hours-completion PDF receipt.

When a GTA admin opens the dashboard:

1. **The browser** prompts for the admin PIN.
2. **The browser** sends the PIN + a `getStats` request to Apps Script.
3. **Apps Script** verifies the PIN, reads all rows from the sheet, and returns aggregated stats.
4. **The browser** renders KPI cards, charts, and tables.

The Google Sheet is the single source of truth — everything else is just a polished view of it.

---

## Daily limits & quotas to know

| Thing | Free Gmail account | Google Workspace account |
|---|---|---|
| Confirmation emails sent per day | **100** | **1500** |
| Apps Script execution time per day | **6 hours total** | **6 hours total** |
| Sheet size | up to **10 million cells** | up to **10 million cells** |

For a single GTA event with even 500 student volunteers, you're well within all free-tier limits.

---

## When you need to update something

- **Change form fields** → edit `index.html`, also update the `HEADERS` array in `apps-script-backend.gs`, then redeploy the Apps Script (Deploy → Manage deployments → ✏️ → New version).
- **Change confirmation email wording** → edit the `buildRegistrationHtml` / `buildHoursHtml` functions in `apps-script-backend.gs`, then redeploy.
- **Change admin PIN** → edit `ADMIN_PIN` in `apps-script-backend.gs`, then redeploy.
- **Fix anything in the form's appearance/logic** → edit `index.html`, `app.js`, or `chat-assistant.js`, then re-upload to your host (no Apps Script redeploy needed).

For minor static-file changes, the redeploy is just "re-upload the file to your host." For backend changes, you redeploy the Apps Script as a New Version (URL stays the same).

---

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Form submits but nothing in sheet | Apps Script URL wrong in `config.js` | Re-copy the `/exec` URL from Apps Script → paste into `config.js` |
| Form shows "Sync failed" | Apps Script "Who has access" not set to Anyone | Redeploy with that setting |
| Confirmation email never arrives | MailApp not authorized | In Apps Script, click Run on `sendRegistrationEmail` once → click through the auth prompt |
| Admin dashboard says "Invalid PIN" | PIN in code doesn't match what you typed | Verify `ADMIN_PIN` in Apps Script, and that you redeployed as a New Version |
| Form's chat shows generic answers | Groq API key not set | Either set the key in `config.js` or accept the FAQ as the chat |
| Phone can't reach local app | Different Wi-Fi, or firewall blocking port 8080 | Same Wi-Fi; allow Python through Windows Firewall |

For more detail on any of these, see `SETUP.md` → Troubleshooting and `INSTALL.md` → Troubleshooting.

---

## Files in this deployment (for reference)

| File | Role | Where it lives |
|---|---|---|
| `index.html` | The form | Hosted publicly |
| `app.js` | Form logic | Hosted publicly |
| `chat-assistant.js` | AI chat helper | Hosted publicly |
| `config.js` | App config (URLs, keys) | Hosted publicly |
| `manifest.json` + `service-worker.js` + `icon.svg` | PWA installability | Hosted publicly |
| `admin.html` | Admin dashboard | Hosted publicly (gated by PIN) |
| `qr-poster.html` | Printable QR poster | Use locally or host |
| `apps-script-backend.gs` | Backend code | Pasted into Google Apps Script (not on your host) |
| `local-qr.html` + `start-app.bat` + `start-app.sh` | Local-testing helpers | Use on your computer |
| `DEPLOY.md` (this) + `SETUP.md` + `REDEPLOY.md` + `INSTALL.md` | Documentation | For you, not students |

You're done. Welcome to the GTA Volunteer App.
