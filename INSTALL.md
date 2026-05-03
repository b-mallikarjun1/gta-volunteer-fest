# GTA Volunteer App — Local Desktop Install

This is the **fast-start guide** for running the app on your own computer (for testing or local-only use). For full deployment to GitHub Pages / Netlify so anyone on the internet can use it, see **SETUP.md** instead.

## What you'll get

After 2 minutes of setup:
- The volunteer form running at **http://localhost:8080** on your computer
- A QR code your phone can scan (when on the same Wi-Fi) to test the form on mobile
- The admin dashboard at **http://localhost:8080/admin.html**

This is perfect for: testing the app before going public, demoing it to GTA leadership, or running it on a single laptop at the event registration desk.

## Mental model

Think of your computer as a tiny private cafe. The local web server is the espresso machine — it brews and serves the app to anyone who walks in. **localhost** is your own seat at the counter; the **LAN IP** (like `192.168.1.42`) is the cafe's address that anyone on the same Wi-Fi can find. The server doesn't know about the wider internet — only people on the same Wi-Fi can visit.

## Step-by-step (Windows)

### 1. Make sure you have Python (one-time, ~5 min)

Open Command Prompt and type:

```
python --version
```

If you see something like `Python 3.x.x`, you're set — skip to step 2.

If not:
1. Visit [python.org/downloads](https://www.python.org/downloads/)
2. Download and run the installer
3. **Important:** tick the box "Add python.exe to PATH" before clicking Install
4. Restart Command Prompt and try the version check again

(Don't have Python and don't want to install it? Node.js works too — `start-app.bat` will detect either one.)

### 2. Run the app

Just **double-click `start-app.bat`** in the C:\Volforum folder.

A black console window opens, prints your URLs, and your default browser auto-opens to the form.

### 3. Test on your phone

1. Open `local-qr.html` in your browser (it's right in the same folder — double-click it). Or visit `http://localhost:8080/local-qr.html` directly.
2. The page shows a QR code containing your computer's LAN IP.
3. Connect your phone to the same Wi-Fi as your computer.
4. Open your phone camera, point at the QR, tap the link.
5. The form loads on your phone — fill it out and submit to test the full flow.

### 4. Open the admin dashboard

Visit **http://localhost:8080/admin.html** in your browser. Type your admin PIN (the one you set in `apps-script-backend.gs`) and you'll see the live stats dashboard.

### 5. To stop the server

Click into the black console window and press `Ctrl+C` (or just close the window).

## Step-by-step (Mac / Linux)

Same idea, different starter script. In Terminal:

```bash
cd /path/to/C:\Volforum   # or wherever the folder lives
chmod +x start-app.sh     # one-time, makes the script executable
./start-app.sh
```

Or just `bash start-app.sh` without making it executable.

## Troubleshooting

### "Python not recognized" / nothing happens
- Python isn't installed (or isn't in your PATH). Re-run the installer and tick "Add python.exe to PATH". Or install Node.js instead.

### Browser opens but page is blank or shows file-not-found
- Make sure `start-app.bat` is in the **same folder** as `index.html`. The script serves the folder it's run from.

### Phone says "this site can't be reached"
Three usual causes:
1. **Wrong Wi-Fi.** Phone must be on the same network as your computer. Some networks (corporate, public Wi-Fi, mobile hotspots) isolate clients — try a regular home Wi-Fi.
2. **Firewall blocking port 8080.** When you start the server, Windows may pop up a "Allow Python through Windows Firewall" dialog — click **Allow**. If you missed it, go to *Windows Security → Firewall & network protection → Allow an app through firewall* and add Python.
3. **Wrong IP in the QR.** If `local-qr.html` shows `localhost`, you opened it via `localhost`. Re-open it via your LAN IP instead — e.g., visit `http://192.168.1.42:8080/local-qr.html`. The batch file prints your LAN IP at the top.

### Submissions don't sync to Google Sheets
- That's expected if `config.js` still has the placeholder URL. Local testing of the form & PDF works without it; the Google Sheet sync only kicks in once you've deployed the Apps Script backend (see SETUP.md → Stage 1).

### Confirmation emails don't arrive
- Same reason — the email sender is the Apps Script backend. Without that deployed, no emails go out. Locally, you'll see the success screen but no email. Once Apps Script is deployed, locally-submitted forms will trigger emails too (because the form posts to your hosted Apps Script URL, not to localhost).

### "Port 8080 is already in use"
- Another program is using port 8080. Either close that program or edit `start-app.bat` to change `8080` to e.g. `8081` (search for `8080` and replace all instances).

## What's running where

| URL | Lives where | Used for |
|---|---|---|
| `http://localhost:8080` | Your computer | The volunteer form (you, your phone via LAN IP) |
| `http://[YOUR-IP]:8080` | Your computer (same server) | Phone testing on the same Wi-Fi |
| `http://localhost:8080/admin.html` | Your computer | Admin dashboard |
| `http://localhost:8080/local-qr.html` | Your computer | The QR for phone testing |
| `https://script.google.com/...` | Google's servers | Where form data is sent and emails are triggered (configured in `config.js`) |
| `https://docs.google.com/...` | Google's servers | The actual GTA volunteer sheet |

The form itself can run from anywhere (your laptop, GitHub Pages, Netlify) — but the Apps Script backend always lives on Google's servers. That's by design: it means the sheet, email sending, and admin stats all keep working the same way no matter where the form is hosted.

## When to leave local testing and go public

Local install is great for:
- Testing the full flow before GTA distributes it
- Demoing to GTA leadership at a meeting
- Single-laptop registration kiosk at the event entrance

Time to go public (move to GitHub Pages / Netlify) when:
- GTA wants to email a single link to multiple schools
- You need the QR poster to work for any phone, anywhere
- The event is approaching and you want one stable URL

The transition is painless — same files, just upload the C:\Volforum folder to GitHub Pages or drop it on Netlify.
