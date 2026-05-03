/* ============================================================
   App Configuration
   --------------------------------------------------------------
   This is the ONLY file your school admin needs to edit.
   After deploying the Apps Script web app (see SETUP.md),
   paste the deployment URL into appsScriptUrl below.
   ============================================================ */

const CONFIG = {
  // --- Google Sheets sync ---
  // Paste your Apps Script web-app URL here. It will look like:
  // https://script.google.com/macros/s/AKfycb.../exec
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwvmsRNlEUVkU-pFadXzPabLsT1A1FS90JzLdrl9R1Ovqoubtz1gIveAJIwv1C6N39htw/exec',

  // --- AI Chat Assistant (optional) ---
  // Free Groq API key — get one at https://console.groq.com/keys
  // Leave as 'YOUR_GROQ_KEY_HERE' to disable AI; chat will use built-in FAQ instead.
  // Note: this key is visible in the browser. Use a Groq key with rate limits set,
  // and rotate it if abused. Free tier costs nothing.
  groqApiKey: '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',

  // School name shown in the QR poster (optional)
  schoolDisplayName: 'Our School'
};
