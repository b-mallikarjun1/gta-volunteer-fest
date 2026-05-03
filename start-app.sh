#!/usr/bin/env bash
# ===========================================================
#   GTA International Fest - Volunteer App
#   Local Server (macOS / Linux)
# ===========================================================
#   Run with:  bash start-app.sh
#   Or make executable:  chmod +x start-app.sh && ./start-app.sh
# ===========================================================

cd "$(dirname "$0")"

PORT=8080

# Detect LAN IP (works on macOS and most Linux distros)
if command -v ipconfig >/dev/null 2>&1; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$LAN_IP" ] && command -v hostname >/dev/null 2>&1; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="YOUR-COMPUTER-IP"
fi

cat <<EOF

 ===========================================================
   GTA International Fest - Volunteer App
   Local Server
 ===========================================================

   On THIS computer:    http://localhost:$PORT
   On phone / tablet:   http://$LAN_IP:$PORT

   Phone testing:
     1. Connect your phone to the SAME Wi-Fi as this computer
     2. Open local-qr.html in your browser to see a QR
     3. Scan the QR with your phone camera

   Admin dashboard:     http://localhost:$PORT/admin.html

   Press Ctrl+C to stop the server when done.
 ===========================================================

EOF

# Open browser (best-effort)
URL="http://localhost:$PORT"
if command -v open >/dev/null 2>&1; then
  open "$URL" &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" &
fi

# Start a server — try Python 3, then Python 2, then Node
if command -v python3 >/dev/null 2>&1; then
  echo "[Python 3 detected] Starting server..."
  python3 -m http.server $PORT
elif command -v python >/dev/null 2>&1; then
  echo "[Python detected] Starting server..."
  python -m http.server $PORT 2>/dev/null || python -m SimpleHTTPServer $PORT
elif command -v npx >/dev/null 2>&1; then
  echo "[Node.js detected] Starting server..."
  npx --yes serve -l $PORT .
else
  echo ""
  echo "ERROR: No web server runtime found."
  echo ""
  echo "Install Python: https://www.python.org/downloads/"
  echo "Or install Node: https://nodejs.org/"
  echo ""
  exit 1
fi
