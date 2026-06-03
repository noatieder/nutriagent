#!/usr/bin/env python3
"""
NutriAgent Dev Log Server
Serves static files + receives browser console logs via POST /log
Run: python3 logserver.py
Open: http://localhost:3131/index-2.html
"""

import http.server
import json
import os
from datetime import datetime, timezone

PORT    = 3131
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ANSI color codes
R  = "\033[0m"
B  = "\033[1m"
D  = "\033[2m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
GRAY   = "\033[90m"
PURPLE = "\033[95m"
WHITE  = "\033[97m"
ORANGE = "\033[38;5;214m"

LEVEL_COLOR = {
    "debug": GRAY,
    "info":  CYAN,
    "warn":  YELLOW,
    "error": RED,
}
LEVEL_LABEL = {
    "debug": "DEBUG",
    "info":  "INFO ",
    "warn":  "WARN ",
    "error": "ERROR",
}

def format_log(entry):
    lvl  = entry.get("level", "info").lower()
    mod  = entry.get("module", "?")
    msg  = entry.get("message", "")
    data = entry.get("data")
    ts   = entry.get("timestamp", "")

    # Parse timestamp → HH:MM:SS.mmm
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
        ts_str = t.strftime("%H:%M:%S.%f")[:12]
    except Exception:
        ts_str = ts[-12:] if ts else "??:??:??.???"

    col   = LEVEL_COLOR.get(lvl, WHITE)
    label = LEVEL_LABEL.get(lvl, "INFO ")

    line = f"  {D}{ts_str}{R}  {col}{B}{label}{R}  {PURPLE}[{mod}]{R}  {msg}"

    if data is not None:
        try:
            ds = json.dumps(data, ensure_ascii=False, indent=2)
            indented = "\n".join("      " + l for l in ds.splitlines())
            line += f"\n{D}{indented}{R}"
        except Exception:
            line += f"\n      {D}{repr(data)}{R}"

    return line


class LogHandler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # ── CORS preflight ──────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    # ── Log receiver ────────────────────────────────────────────
    def do_POST(self):
        if self.path == "/log":
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length)
            try:
                entry = json.loads(raw)
                print(format_log(entry), flush=True)
            except Exception as e:
                print(f"  {RED}[logserver parse error]{R} {e}  raw={raw[:120]}", flush=True)

            self.send_response(204)
            self._cors_headers()
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    # ── Static file serving — add CORS headers ─────────────────
    def end_headers(self):
        self._cors_headers()
        super().end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # ── Suppress noisy access log for /log posts ────────────────
    def log_message(self, fmt, *args):
        path = args[0].split()[1] if args and " " in args[0] else ""
        if path == "/log":
            return  # already printed by format_log
        code = str(args[1]) if len(args) > 1 else "?"
        col  = GREEN if code.startswith("2") else YELLOW if code.startswith("3") else RED
        print(f"  {D}{self.address_string()}{R}  {col}{code}{R}  {D}{path}{R}", flush=True)


if __name__ == "__main__":
    os.chdir(BASE_DIR)

    print(f"\n{B}{GREEN}{'━'*52}{R}")
    print(f"{B}{GREEN}  🌿 NutriAgent Dev Log Server{R}")
    print(f"{B}{GREEN}{'━'*52}{R}")
    print(f"  {WHITE}App:   {CYAN}http://localhost:{PORT}/index-2.html{R}")
    print(f"  {WHITE}Logs:  POST http://localhost:{PORT}/log{R}")
    print(f"  {WHITE}Stop:  Ctrl+C{R}")
    print(f"{D}{'─'*52}{R}\n")

    with http.server.ThreadingHTTPServer(("", PORT), LogHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print(f"\n{YELLOW}  Server stopped.{R}\n")
