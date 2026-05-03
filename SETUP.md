# GTA International Fest — Volunteer Registration App

A cross-platform volunteer signup app built for the **Global Telangana Association (GTA)**, used to recruit middle school and high school student volunteers for the **GTA International Fest**.

Works on **Android, iOS, Windows, and Mac** from a single codebase. Students fill it out on their phone, parents give consent right inside the form, and every registration flows automatically into a GTA-managed Google Sheet.

## Who runs what

- **GTA volunteer coordination team** — owns the Google Sheet, deploys the backend, distributes the QR/link to partner schools, and manages volunteers.
- **Schools** — receive the link/QR from GTA and forward it to interested students. Schools don't need to do any setup.
- **Students & parents** — open the link, fill the form (with parent consent), and they're registered.

## What's in the Box

| File | Purpose |
|---|---|
| `index.html` | The main app — the volunteer registration form |
| `admin.html` | **GTA admin dashboard** — live stats, charts, follow-up list |
| `app.js` | App logic (form, PDF receipt, sync) |
| `chat-assistant.js` | Floating AI helper that answers student questions about the GTA event |
| `config.js` | **The only file GTA edits** — paste your sync URL & API key here |
| `manifest.json` | Tells phones/desktops "this can be installed as an app" |
| `service-worker.js` | Caches the app so it works offline (e.g., on the bus) |
| `icon.svg` | App icon |
| `qr-poster.html` | A printable / emailable QR poster GTA sends to schools |
| `apps-script-backend.gs` | Backend code GTA pastes into Google Apps Script |
| `start-app.bat` | **Windows: double-click to run the app on your desktop locally** |
| `start-app.sh` | **Mac/Linux: bash script to run the app locally** |
| `local-qr.html` | LAN-aware QR generator for phone testing on local Wi-Fi |
| `INSTALL.md` | Quick-start guide for local desktop deployment (vs SETUP.md which is for production) |
| `SETUP.md` | This file (production deployment guide) |

## How It All Connects (mental model)

Think of GTA as the host of a community potluck, the schools as the megaphone, and the students as the helpers:

1. **GTA hosts the form** at one URL — like the address of the potluck.
2. **Schools share the link/QR** with their students — the megaphone.
3. **Students fill the form** with their parent — they're signing up to help.
4. **A PDF receipt downloads** to the student's device — their personal copy.
5. **Every registration appears** in GTA's Google Sheet within seconds — GTA's master volunteer list.
6. **After the event**, the student comes back to the same app, taps the **⏱️ Submit Hours** tab, enters their email + last name, and logs their actual hours. The app finds their row in the GTA sheet and updates it automatically — and gives them a polished hours-receipt PDF for community-service credit.
7. **No internet?** No problem. The registration form queues offline; hours submission needs internet (because it has to look up the student's existing row).

## Setup — Done Once by GTA (~15 minutes total)

### Stage 1: Set up GTA's Google Sheet backend (5 min)

1. A GTA admin signs into [sheets.google.com](https://sheets.google.com) with the GTA Google account and creates a **new blank sheet**.
2. Rename it: **"GTA International Fest — Volunteer Registrations"**.
3. In the menu: **Extensions → Apps Script**.
4. Delete any code that's there. Open `apps-script-backend.gs` from this folder, copy everything in it, and **paste it into the Apps Script editor**.
5. Click the **Save (💾)** icon. Name the project "GTA Volunteer Backend".
6. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - **Description**: GTA Volunteer Form Backend
   - **Execute as**: Me
   - **Who has access**: **Anyone** (this is required so students' phones can submit)
   - Click **Deploy**.
7. Google will ask you to **authorize**. Click through the warning ("Advanced → Go to [project name]") — this is normal.
8. Copy the **Web app URL** it gives you (it ends in `/exec`).

### Stage 2: Wire the app to the GTA sheet (1 min)

1. Open `config.js` in any text editor (Notepad, TextEdit, VS Code — all fine).
2. Find the line that says `appsScriptUrl: '...'`.
3. Paste the URL from Stage 1 between the quotes.
4. Save.

### Stage 3: Host the app online (5 min — pick one option)

The app needs a public URL so students can scan a QR or click a link. Pick whichever is easiest for GTA:

#### Option A — GitHub Pages (free, recommended)
1. Use a GTA GitHub account (or create a free one at [github.com](https://github.com)).
2. Create a new repository called `gta-volunteer-fest`.
3. Upload all the files from this folder into it.
4. Go to **Settings → Pages**. Under "Source", pick "main" branch, root folder. Save.
5. After ~1 minute, the app is live at `https://GTA-USERNAME.github.io/gta-volunteer-fest/`.

#### Option B — Netlify Drop (even faster, no account)
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the entire folder onto the page.
3. You get a public URL instantly. (You'll want a free Netlify account to keep the URL permanent.)

#### Option C — GTA's existing website
If GTA already has a website, drop the folder into a subdirectory (e.g., `gta.org/volunteer/`).

### Stage 3.5: Turn on the AI chat assistant (optional, 3 min)

The form has a floating chat bubble (bottom-right). Out of the box it answers about a dozen common questions from a built-in FAQ — works without any setup. To upgrade to a real conversational AI:

1. Go to [console.groq.com/keys](https://console.groq.com/keys) and sign up (free, no credit card).
2. Click **Create API Key**, name it "GTA Volunteer App", copy the key.
3. Open `config.js` and replace `YOUR_GROQ_KEY_HERE` with your key (keep the quotes).
4. Save. Re-upload `config.js` to your host.

Now the chat answers any open-ended question students ask — "Can my friend and I volunteer together?", "Will there be food at the event?", "What if I don't speak Telugu?", etc.

**Privacy note:** When AI is enabled, the student's typed message is sent to Groq's servers. Groq does not use free-tier traffic for training. If GTA prefers everything stay on-device, leave the key blank — the FAQ takes over.

**Cost:** Groq's free tier handles ~30 requests/min for free, with no per-message charge.

### Stage 3.6: Configure confirmation emails (2 min)

The app automatically sends two emails:

1. **Registration confirmation** — sent the moment a student submits the form. Goes to the student's email, CCs the parent's email. Includes a summary of their registration and what to expect next.
2. **Hours-completed thank-you** — sent when the student logs hours after the event. Confirms the hours and explains how to use the receipt for community-service credit.

**To configure**, open the Apps Script and find the `GTA_CONFIG` block near the top:

```js
const GTA_CONFIG = {
  senderName: 'Global Telangana Association',
  contactEmail: 'volunteers@gta.example.org',  // ← change this!
  eventDate: 'TBD — the GTA team will email you...',
  eventWebsiteUrl: '',  // optional
  sendConfirmationEmails: true
};
```

- **`contactEmail`** — set this to the real GTA volunteer-coordinator email so replies and questions land in the right inbox.
- **`eventDate`** — once GTA finalizes the date, paste it here so future confirmations include it.
- **`sendConfirmationEmails`** — set to `false` if GTA wants to disable emails entirely.

**Where the email comes "from":** the email is sent from the Gmail account that owns the Apps Script (the GTA admin who deployed the backend). Use a dedicated GTA Gmail account if possible — like `gta.volunteers@gmail.com` — so replies go to the team rather than to one person.

**The first time you save the script**, Google asks you to authorize "Send email as you." Click through and accept — without this, emails will silently fail (registrations still work).

**Daily limit:**
- Free Gmail accounts: **100 emails/day**
- Google Workspace accounts (paid): **1500 emails/day**

For most events this is more than enough. If GTA expects 200+ registrations on a single day, use a Workspace account or temporarily set `sendConfirmationEmails: false`. The script automatically logs (but doesn't fail) if the quota is hit — registrations still succeed.

**Test it:** after deploying, submit a test registration with your own email address. You should receive the confirmation email within seconds.

### Stage 3.7: Set the admin PIN for the dashboard (1 min)

GTA gets a live dashboard at `/admin.html` (e.g., `https://your-host.example.com/admin.html`) showing volunteer stats, charts, and a follow-up list. It's gated by a PIN you set in the Apps Script.

1. In the Apps Script editor, find the line near the top:
   ```js
   const ADMIN_PIN = 'CHANGE-ME-12345';
   ```
2. Replace `CHANGE-ME-12345` with a strong PIN (8+ characters, e.g., `GTA2026Fest!`). Keep the quotes.
3. Save the script.
4. **Re-deploy** so the new PIN takes effect: Deploy → Manage deployments → pick your deployment → ✏️ → Version: New version → Deploy. The URL stays the same.

Now any GTA admin who knows the PIN can open `admin.html` in a browser, type the PIN, and see live volunteer stats. The PIN is remembered for that browser session only — closing the tab requires re-entry.

**What the dashboard shows:**

- **5 KPI cards**: Total Registered · Total Completed · Pending Follow-up · Hours Pledged · Hours Completed
- **Charts**: Volunteers by School (bar) · Roles distribution (donut) · By Grade Level (bar) · Registered vs Completed (funnel)
- **Recent Registrations table**: last 10 sign-ups
- **Pending Follow-up table**: registered students who haven't logged hours yet — with their email and parent phone so GTA can nudge them

**Security notes:**
- The PIN is the only barrier between the public internet and GTA's volunteer list. **Use a strong PIN.**
- The dashboard never modifies data — read-only.
- The PIN is sent over HTTPS to Google's servers; never stored anywhere except in the admin's browser sessionStorage (cleared on tab close).
- If the PIN is leaked, change it in Apps Script and redeploy — anyone using the old PIN is locked out.

### Stage 4: Print or email the QR poster (2 min)

1. Open `qr-poster.html` in a browser.
2. Paste the GTA app URL into the box at the top.
3. Click **Update Poster**, then **Print Poster** (or save as PDF and email to schools).
4. Distribute to partner schools — they can print and post in hallways, libraries, counselor offices, or include the link in school newsletters.

## Distribution Flow

```
GTA admin sets up → Hosts app at one URL → Generates one QR poster
       ↓
GTA emails partner schools (with link + QR poster attached)
       ↓
Schools share with interested students (newsletter, posters, classroom)
       ↓
Students open link → Fill form with parent → Submit
       ↓
Registration appears instantly in GTA's Google Sheet
       ↓
GTA team reaches out to confirm role and schedule
```

## How Students Use It

### On a phone (Android or iPhone)
1. Tap the link from GTA / their school / scan the QR poster.
2. Fill out the form (must be with a parent — consent is required).
3. Tap **Submit Form & Generate Report**.
4. PDF receipt lands in Downloads.
5. Registration appears in GTA's sheet within seconds.

### To "install" the form as an app (optional)
- **iPhone (Safari)**: Share button → **Add to Home Screen**.
- **Android (Chrome)**: Menu → **Install app** or **Add to Home Screen**.
- **Windows / Mac (Chrome or Edge)**: Install icon (⊕) in the address bar.

After install it opens like a real app with its own icon — useful if students need to come back and register more friends.

## Where the Registrations Are Saved

| Location | What lives there | Who can see it |
|---|---|---|
| **Student's Downloads folder** | Two PDFs over time: registration receipt at sign-up, and hours-completion receipt after the event | The student & their parent |
| **GTA's Google Sheet** | One row per registration. After the student logs hours, the same row gets filled with `Actual Hours Completed`, `Hours Submitted At`, and `Volunteer Notes`, and the row turns green | The GTA volunteer coordination team |
| **Device's offline queue** | Registrations submitted offline (clears automatically when back online) | Just on the device temporarily |

## The Two-Step Volunteer Lifecycle

```
BEFORE the event                          AFTER the event
─────────────────                          ────────────────
Student opens app                          Student opens app
       ↓                                          ↓
Tap "📝 Register" tab (default)            Tap "⏱️ Submit Hours" tab
       ↓                                          ↓
Fill form with parent consent              Enter email + last name + hours
       ↓                                          ↓
Submit → row added to GTA sheet            Submit → matching row updated
       ↓                                          ↓
PDF registration receipt downloads         PDF hours-receipt downloads
       ↓                                          ↓
📧 Confirmation email sent                 📧 Thank-you email sent
   to student (CC: parent)                    to student (CC: parent)
                                                  ↓
                                          Row turns GREEN in GTA sheet
                                          to flag completed volunteers
```

## Important: If You Updated From an Earlier Version

If GTA already deployed an older version of this app (without the hours-submission feature), you need to redeploy the Apps Script so the new columns and routes activate:

1. In Apps Script, paste the new `apps-script-backend.gs` over the old code.
2. **Deploy → Manage deployments** → click the existing deployment → click the pencil ✏️.
3. Change "Version" to **New version**, click **Deploy**. The web-app URL stays the same.
4. The next registration will auto-add the new columns to the existing sheet — no data loss.

## Customization

- **Change event name everywhere**: Search for "GTA International Fest" in `index.html`, `app.js`, `chat-assistant.js`, `manifest.json`, `qr-poster.html`, `apps-script-backend.gs` and rename if you reuse the app for a different GTA event.
- **Pre-fill the Organization field**: Already pre-filled with "Global Telangana Association — GTA International Fest" in `index.html`.
- **Add/change volunteer roles in the AI**: Edit the system prompt in `chat-assistant.js`.
- **Change colors**: Edit the `:root` CSS variables at the top of `index.html`.

## Troubleshooting

**"Sync failed" message after submitting**
→ Check that `appsScriptUrl` in `config.js` matches the deployment URL exactly, and that the deployment's "Who has access" is set to **Anyone**.

**Students see "this site can't be reached"**
→ The hosted URL is wrong. Re-check the URL in the QR poster and the link emailed to schools.

**Chat assistant gives generic answers only**
→ The Groq API key isn't set in `config.js`, or the key is invalid. The FAQ fallback still works.

**The icon looks generic when installed on iPhone**
→ Apple prefers a `.png` icon. The included `icon.svg` works on most devices; for a perfect Apple icon, use any free converter to make a 180×180 PNG and add `<link rel="apple-touch-icon" href="apple-icon.png" />` in `index.html`.

## Want a Native App Store Version?

This PWA covers all four platforms from one codebase, which is the recommended path for a single-event registration app. If GTA wants a real Google Play / App Store listing, you can wrap this app using the free [PWABuilder](https://www.pwabuilder.com/) — paste the hosted URL, and it generates installable packages for each store. Apple and Google charge developer fees ($99/yr and $25 one-time).
