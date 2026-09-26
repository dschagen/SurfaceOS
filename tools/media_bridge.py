"""Local helper that lets the SurfaceOS music widget control system media on Windows.

Run from the repository root:  python tools/media_bridge.py
The browser widget talks to http://127.0.0.1:8766. Standard library only.

  GET  /media/status        -> {"ok": true, "now_playing": {...} or null, "now_playing_supported": bool}
  POST /media/<command>     -> presses a media key; command is one of COMMANDS below

Control uses the system media keys, so it works with Spotify, browser tabs, and most players.
Track info comes from the Windows media session API through a PowerShell process.
"""

import argparse
import base64
import ctypes
import json
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VIRTUAL_KEYS = {
    "play_pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "mute": 0xAD,
    "volume_down": 0xAE,
    "volume_up": 0xAF,
}
COMMANDS = set(VIRTUAL_KEYS)
KEYEVENTF_EXTENDEDKEY = 0x1
KEYEVENTF_KEYUP = 0x2

# Only pages served from this machine may call the helper from a browser.
ALLOWED_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")

# Prints the current media session as one JSON line per second until stdin closes.
NOW_PLAYING_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) ($managerType)
while ($true) {
  try {
    $session = $manager.GetCurrentSession()
    if ($null -eq $session) { $line = '{"now_playing":null}' }
    else {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ($propsType)
      $line = @{ now_playing = @{
        title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle
        status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
        app = $session.SourceAppUserModelId
      } } | ConvertTo-Json -Compress
    }
  } catch { $line = (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress) }
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
"""


def press_media_key(command: str) -> None:
    key = VIRTUAL_KEYS[command]
    user32 = ctypes.windll.user32
    user32.keybd_event(key, 0, KEYEVENTF_EXTENDEDKEY, 0)
    user32.keybd_event(key, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)


def friendly_app_name(app_id: str) -> str:
    """Turns IDs like 'Spotify.exe' or 'Chrome' into a short display name."""
    if not app_id:
        return ""
    name = app_id.split("!")[-1].split("\\")[-1]
    name = re.sub(r"\.exe$", "", name, flags=re.IGNORECASE)
    return {"msedge": "Edge", "chrome": "Chrome", "spotify": "Spotify"}.get(name.lower(), name)


class NowPlayingWatcher:
    """Keeps one PowerShell process running and remembers the latest track it reported."""

    def __init__(self) -> None:
        self.supported = sys.platform == "win32"
        self.latest: dict | None = None
        self.updated_at = 0.0
        self._lock = threading.Lock()

    def start(self) -> None:
        if self.supported:
            threading.Thread(target=self._run, daemon=True).start()

    def snapshot(self) -> tuple[dict | None, bool]:
        with self._lock:
            # Treat stale data as unknown if the PowerShell process stopped reporting.
            fresh = time.monotonic() - self.updated_at < 5
            return (self.latest if fresh else None), self.supported

    def _run(self) -> None:
        encoded = base64.b64encode(NOW_PLAYING_SCRIPT.encode("utf-16-le")).decode("ascii")
        while True:
            try:
                process = subprocess.Popen(
                    ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.PIPE, text=True,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except OSError as error:
                print(f"Track info unavailable: {error}")
                self.supported = False
                return
            for line in process.stdout:
                self._handle_line(line)
            process.wait()
            print("Track info process exited; restarting in 3 seconds")
            time.sleep(3)

    def _handle_line(self, line: str) -> None:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            return
        if "error" in message:
            return
        track = message.get("now_playing")
        if track:
            track = {
                "title": track.get("title") or "",
                "artist": track.get("artist") or "",
                "album": track.get("album") or "",
                "status": track.get("status") or "",
                "app": friendly_app_name(track.get("app") or ""),
            }
        with self._lock:
            self.latest = track
            self.updated_at = time.monotonic()


watcher = NowPlayingWatcher()


class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if ALLOWED_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "X-SurfaceOS")

    def _send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or bool(ALLOWED_ORIGIN.match(origin))

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self._send_json(403, {"ok": False, "error": "origin not allowed"})
            return
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path != "/media/status":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        now_playing, supported = watcher.snapshot()
        self._send_json(200, {"ok": True, "now_playing": now_playing, "now_playing_supported": supported})

    def do_POST(self) -> None:
        # The custom header forces a CORS preflight, so other websites cannot press keys.
        if not self._origin_allowed() or self.headers.get("X-SurfaceOS") != "1":
            self._send_json(403, {"ok": False, "error": "forbidden"})
            return
        match = re.fullmatch(r"/media/([a-z_]+)", self.path)
        command = match.group(1) if match else ""
        if command not in COMMANDS:
            self._send_json(404, {"ok": False, "error": f"unknown command {command!r}"})
            return
        if sys.platform != "win32":
            self._send_json(501, {"ok": False, "error": "media keys are only implemented on Windows"})
            return
        press_media_key(command)
        self._send_json(200, {"ok": True, "command": command})

    def log_message(self, format: str, *args) -> None:
        # Status polling every two seconds would flood the console.
        if self.command != "GET":
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    watcher.start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"SurfaceOS media bridge on http://127.0.0.1:{args.port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
