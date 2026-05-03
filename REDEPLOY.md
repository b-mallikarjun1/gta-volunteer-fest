# GTA Volunteer App — Redeploy Checklist

You already have a deployed version. This is a focused one-page checklist for **pushing the latest updates** to it. Use this instead of the full SETUP.md when you just need to update what you have.

## What changed since you first deployed

| Feature | Status | What needs redeploy? |
|---|---|---|
| Original registration form | Already deployed | No change |
| Volunteer role dropdown (5 roles + Other) | New | Re-upload `index.html` |
| AI chat assistant (Groq + FAQ fallback) | New | Re-upload `chat-assistant.js`, `index.html`, `config.js` |
| Hours submission flow (after volunteering) | New | **Apps Script redeploy required** |
| Admin dashboard (`admin.html`) | New | Re-upload `admin.html`; **Apps Script redeploy required** |
| Confirmation emails (registration + hours) | New | **Apps Script redeploy + first-time MailApp authorization** |
| Local desktop installer (`start-app.bat`) | New | No deploy — runs on your computer |

## The redeploy in 5 stages (~10 minutes total)

### Stage A — Apps Script: paste the new backend code (3 min)

1. Open your existing GTA volunteer Google Sheet.
2. **Extensions → Apps Script** to open the script editor.
3. **Select all the existing code (Ctrl+A) → delete it.**
4. Open `C:\Volforum\apps-script-backend.gs` in Notepad, copy everything (Ctrl+A → Ctrl+C), and **paste into the Apps Script editor**.
5. Save (💾 icon).

### Stage B — Configure the two new constants at the top of the script (2 min)

Find these two blocks near the top of the Apps Script you just pasted, and **edit them**:

```js
// 1. Set a strong admin PIN — you'll type this when opening admin.html
const ADMIN_PIN = 'CHANGE-ME-12345';   // ← change this!

// 2. Set GTA's contact email and event details
const GTA_CONFIG = {
  senderName: 'Global Telangana Association',
  contactEmail: 'volunteers@gta.example.org',   // ← change to GTA's real email
  eventDate: 'TBD — the GTA team will email you with the exact date',  // ← update when known
  eventWebsiteUrl: '',                          // ← optional
  sendConfirmationEmails: true                  // ← false to disable emails
};
```

Save again.

### Stage C — Redeploy the web app (2 min)

1. Click **Deploy → Manage deployments**.
2. Click your existing deployment row → click the **pencil ✏️** (Edit).
3. Under "Version", click the dropdown → choose **New version**.
4. Click **Deploy**.
5. **The web-app URL stays the same** — no need to update `config.js`.

If Google asks you to re-authorize permissions, click through and accept. The new code uses **MailApp** (sending email on your behalf), which needs explicit permission the first time.

### Stage D — Re-upload the static files to your host (3 min)

Whatever host you're using (GitHub Pages, Netlify, your school server), you need to upload the latest versions of these files from `C:\Volforum`:

**New files to upload:**
- `admin.html` *(new — admin dashboard)*
- `chat-assistant.js` *(new — AI chat helper)*
- `local-qr.html` *(new — for local Wi-Fi testing)*
- `start-app.bat` *(new — for running the app locally)*
- `start-app.sh` *(new — Mac/Linux equivalent)*
- `INSTALL.md` *(new — local install guide)*
- `REDEPLOY.md` *(this file)*

**Existing files to overwrite:**
- `index.html` *(role dropdown, tabs for Register/Submit Hours, GTA branding)*
- `app.js` *(hours submission, hours PDF receipt, tab logic, role "Other" handler)*
- `manifest.json` *(updated PWA name to "GTA International Fest")*
- `service-worker.js` *(caches the new files for offline)*
- `qr-poster.html` *(GTA branding update)*
- `SETUP.md` *(documentation updates)*

**Don't touch (your config is already there):**
- `config.js` *(your `appsScriptUrl` is already set; only re-upload if you also added a Groq API key for the AI chat)*

#### Quick uploads by host

- **GitHub Pages**: drag-and-drop the files into your repo on github.com, or `git add . && git commit -m "Update" && git push` from the folder.
- **Netlify**: go to your site dashboard → Deploys → drag the entire `C:\Volforum` folder into the deploy area.
- **Your own server**: FTP/SCP the folder.
- **Just running locally?** Skip this stage entirely. Double-click `start-app.bat` and you're done.

### Stage E — Verify (3 min)

Walk through each piece to confirm everything works:

1. **Open the form** at your deployed URL. You should see:
   - Header: *Global Telangana Association · GTA International Fest*
   - Two tabs: *📝 Register* and *⏱️ Submit Hours*
   - A floating blue chat bubble bottom-right
   - Volunteer Role is a **dropdown** (not a text field)

2. **Submit a test registration** with your own email + last name.
   - PDF downloads to your device ✓
   - **Confirmation email arrives** in your inbox within ~1 minute ✓
   - New row appears in your Google Sheet ✓

3. **Open `your-url/admin.html`** in a new tab.
   - Lock screen appears, asking for the admin PIN ✓
   - Type the PIN you set in Stage B → dashboard loads ✓
   - You see *1 Registered, 0 Completed, 1 Pending hours* ✓
   - Your test registration appears in the "Recent Registrations" table ✓

4. **Submit hours for your test registration**:
   - Click the *⏱️ Submit Hours* tab
   - Enter the same email + last name + e.g., 4 hours
   - Submit → hours-receipt PDF downloads ✓
   - **Thank-you email arrives** in your inbox ✓
   - Refresh the admin dashboard → *1 Completed, 0 Pending* ✓
   - Open the Google Sheet → your row should now be **green** with the hours filled in ✓

If all 4 work, the redeploy is complete.

## Troubleshooting common redeploy issues

**Confirmation email never arrives**
→ The first registration after Apps Script redeploy may trigger a Google authorization prompt for MailApp. Open the Apps Script, click **Run** on `sendRegistrationEmail` once with dummy data — Google will prompt you to allow "Send email as you." Accept, and emails will work going forward.

**Admin dashboard shows "Invalid PIN"**
→ The PIN in `admin.html` and the PIN in your Apps Script must match. If you changed `ADMIN_PIN` in the Apps Script but didn't redeploy as a new version (Stage C), the old code is still running. Redo Stage C.

**Form's chat bubble doesn't show suggestions / shows generic answers**
→ That's the FAQ fallback — it means the Groq API key isn't set in `config.js`. Either set the key (see SETUP.md → Stage 3.5) or accept the FAQ as good enough.

**Hours submission says "We couldn't find a registration"**
→ The email + last name must match what was used at registration exactly (case-insensitive but no typos). If you registered with one email and try to submit hours with a different one, no match. Check the Google Sheet to confirm the registered email/lastname.

**Old registrations are missing the new hours columns**
→ The next time anyone registers OR submits hours, the script auto-adds the missing columns to your sheet. Old data is preserved. You can also force it now by submitting one test registration.

**"This site is not secure" warning when opening admin.html**
→ If you're testing locally over `http://localhost`, browsers may show this. Click *Advanced → Proceed*. On a real HTTPS host (GitHub Pages, Netlify) the warning won't appear.

## What's the same — no need to redo

These already work and don't need any update:
- The Google Sheet itself (data is preserved; new columns auto-added)
- The Apps Script web-app URL (`/exec` URL stays the same after redeploy)
- Your `appsScriptUrl` value in `config.js`
- Any registrations already submitted

## After redeploy — what to share

- **Volunteer form URL**: same as before (e.g., `https://your-host.example.com/`) — for students
- **Admin dashboard URL**: `https://your-host.example.com/admin.html` — for the GTA team (and share the PIN privately)
- **QR poster** (`qr-poster.html`) — for printing/emailing to schools
