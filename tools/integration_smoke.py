"""Browser smoke test of calibration, the shell, widgets, and the hand-input transport.

Drives a real headless Edge or Chrome: mouse input goes through the DevTools protocol as native
mouse events, and hand input goes through the real SurfaceServer WebSocket and protocol encoder.

Run from the repository root:  python tools/integration_smoke.py [--screenshot out.png]
Needs the `websockets` package and Microsoft Edge or Google Chrome. No camera required.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from calibration.coordinate_mapper import CoordinateMapper  # noqa: E402
from calibration.marker_calibration import COLLECT_S, SETTLE_S, MarkerCalibration, parse_request  # noqa: E402
from input.events import (POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE,  # noqa: E402
                          POINTER_UP, TWO_HAND_PINCH_START, TWO_HAND_PINCH_MOVE,
                          TWO_HAND_PINCH_END, TWO_HAND_HOLD, HOLD_PROGRESS, PEACE_SIGN, THUMBS_DOWN,
                          Pointer, SurfaceInputEvent)
from server.protocol import encode, hands_debug_message  # noqa: E402
from server.server import SurfaceServer  # noqa: E402

WIDTH, HEIGHT = 1600, 900
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Browser:
    """Minimal DevTools client: commands, console error collection, and native mouse input."""

    def __init__(self, ws_url: str) -> None:
        self.ws = connect(ws_url, max_size=50_000_000)
        self.next_id = 0
        self.errors: list[str] = []

    def send(self, method: str, **params):
        self.next_id += 1
        message_id = self.next_id
        self.ws.send(json.dumps({"id": message_id, "method": method, "params": params}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == message_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            self._event(message)

    def _event(self, message: dict) -> None:
        method = message.get("method")
        params = message.get("params", {})
        if method == "Runtime.exceptionThrown":
            self.errors.append(params["exceptionDetails"].get("exception", {}).get("description", "exception"))
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            self.errors.append(" ".join(str(arg.get("value", arg.get("description", ""))) for arg in params["args"]))
        elif method == "Log.entryAdded" and params["entry"].get("level") == "error":
            entry = params["entry"]
            # The browser requests /favicon.ico on its own; the shell does not ship one.
            if not entry.get("url", "").endswith("/favicon.ico"):
                self.errors.append(f"{entry.get('text', 'log error')} {entry.get('url', '')}".strip())

    def eval(self, expression: str):
        result = self.send("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in result:
            raise RuntimeError(f"eval failed: {expression}\n{result['exceptionDetails']}")
        return result["result"].get("value")

    def wait_for(self, expression: str, timeout: float = 5.0, label: str = ""):
        deadline = time.time() + timeout
        while time.time() < deadline:
            value = self.eval(expression)
            if value:
                return value
            time.sleep(0.05)
        raise AssertionError(f"Timed out waiting for {label or expression}")

    def mouse(self, kind: str, x: float, y: float, clicks: int = 1, pressed: bool = False) -> None:
        self.send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left" if kind != "mouseMoved" or pressed else "none",
                  buttons=1 if pressed or kind == "mousePressed" else 0, clickCount=clicks)

    def click(self, x: float, y: float) -> None:
        self.mouse("mouseMoved", x, y)
        self.mouse("mousePressed", x, y)
        self.mouse("mouseReleased", x, y)

    def double_click(self, x: float, y: float) -> None:
        self.mouse("mousePressed", x, y, 1)
        self.mouse("mouseReleased", x, y, 1)
        self.mouse("mousePressed", x, y, 2)
        self.mouse("mouseReleased", x, y, 2)

    def drag(self, start: tuple[float, float], end: tuple[float, float], steps: int = 12) -> None:
        self.mouse("mouseMoved", *start)
        self.mouse("mousePressed", *start)
        for i in range(1, steps + 1):
            t = i / steps
            self.mouse("mouseMoved", start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, pressed=True)
        self.mouse("mouseReleased", *end)

    def center(self, selector: str) -> tuple[float, float]:
        box = self.wait_for(f"""(() => {{ const e = document.querySelector({json.dumps(selector)});
            if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()""",
                            label=selector)
        return box[0], box[1]


class Hand:
    """Sends contract events through the real hand-input server and encoder."""

    def __init__(self, server: SurfaceServer) -> None:
        self.server = server
        self.x, self.y = 0.5, 0.5

    def send(self, event_type: str, x: float | None = None, y: float | None = None) -> None:
        if x is not None:
            self.x, self.y = x, y
        self.server.publish(encode(SurfaceInputEvent(event_type, 0, self.x, self.y)))
        time.sleep(1 / 30)

    def move(self, x: float, y: float, steps: int = 8) -> None:
        sx, sy = self.x, self.y
        for i in range(1, steps + 1):
            t = i / steps
            self.send(POINTER_MOVE, sx + (x - sx) * t, sy + (y - sy) * t)

    def pinch(self, x: float, y: float) -> None:
        self.move(x, y)
        for _ in range(9):
            self.send(POINTER_MOVE, x, y)
        self.send(POINTER_DOWN)
        self.send(POINTER_UP)

    def dwell(self, x: float, y: float) -> None:
        self.move(x, y)
        # DWELL_MS in surfaceos-shell/frontend/scripts/dwell.js, plus a margin.
        deadline = time.monotonic() + 4.3
        while time.monotonic() < deadline:
            self.send(POINTER_MOVE, x, y)

    def rectangle(self, event_type: str, x: float, y: float, width: float, height: float) -> None:
        self.server.publish(encode(SurfaceInputEvent(event_type, None, x, y, width, height)))
        time.sleep(1 / 30)

    def hands(self, hands: list[tuple[int, float, float, bool, bool]]) -> None:
        """Sends the debug snapshot of tracked hands: (id, x, y, pinching, primary)."""
        pointers = [Pointer(id=hand_id, x=x, y=y, is_down=pinching, gesture="None") for hand_id, x, y, pinching, _ in hands]
        primary = next((hand_id for hand_id, *_, is_primary in hands if is_primary), None)
        self.server.publish(hands_debug_message(pointers, primary))
        time.sleep(0.1)


def answer_calibration(browser: Browser, hand: Hand) -> dict:
    """Plays the tracker's camera: photographs the projected markers with a browser screenshot
    and solves them with the real marker calibration, so camera coordinates equal page coordinates."""
    deadline = time.monotonic() + 5
    request = None
    while request is None and time.monotonic() < deadline:
        request = next((parse_request(message) for message in hand.server.poll()), None)
        time.sleep(0.05)
    check(request is not None, "shell sends a calibration request with its markers")
    png = base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"])
    frame = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    calibration = MarkerCalibration(CoordinateMapper(False))
    calibration.start(request, 0.0)
    result = calibration.update(frame, SETTLE_S) or calibration.update(frame, SETTLE_S + COLLECT_S)
    hand.server.publish(result)
    return result


def click_button(browser: Browser, container: str, text: str) -> None:
    """Clicks the visible button with this exact text inside container."""
    box = browser.wait_for(f"""(() => {{ const b = [...document.querySelectorAll({json.dumps(container + ' button')})]
        .find(e => e.textContent.trim() === {json.dumps(text)} && e.offsetParent);
        if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()""",
                           label=f"button {text}")
    browser.click(*box)


def dialog_title(browser: Browser) -> str:
    return browser.wait_for("!document.querySelector('#dialog').hidden && document.querySelector('#dialog h2').textContent",
                            label="dialog")


def surface_point(browser: Browser, u: float, v: float) -> tuple[float, float]:
    h = browser.eval("window.SurfaceOS.getState().surfaces[0].h")
    d = h[6] * u + h[7] * v + h[8]
    return (h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def run(browser: Browser, hand: Hand, base_url: str, hand_url: str) -> None:
    browser.send("Page.navigate", url=f"{base_url}/surfaceos-shell/frontend/?hand={hand_url}")
    browser.wait_for("document.readyState === 'complete' && !!window.SurfaceOS", label="shell loaded")
    state = "window.SurfaceOS.getState()"
    check(browser.eval(f"{state}.phase") == "calibration", "startup begins in calibration")
    check(browser.eval("document.querySelectorAll('.corner').length") == 4, "four projector corners appear")
    browser.click(*browser.center("#confirm-surface"))
    check(browser.eval(f"{state}.surfaces.length") == 1, "first surface has a homography")
    browser.click(*browser.center("#finish-setup"))
    browser.click(*browser.center("#dialog button:first-child"))
    check(browser.wait_for("!!document.querySelector('.marker-plane')", label="markers"), "markers are projected on the surface")
    result = answer_calibration(browser, hand)
    check(result["ok"] and result["markers_found"] == 12, f"all 12 markers found ({result.get('error_px')} px error)")
    check(browser.wait_for(f"{state}.phase === 'finger'", label="fingertip step"), "camera mapping is accepted")
    hand.dwell(*surface_point(browser, .5, .5))
    check(browser.wait_for(f"{state}.phase === 'camera-check'", label="check step"), "fingertip hold on C records the offset")
    hand.dwell(*surface_point(browser, .5, .22))
    check(browser.wait_for(f"{state}.phase === 'workspace'", label="hand alignment"), "hold on OK accepts the surface")
    check(browser.eval(f"{state}.windows.length") == 0, "no windows restored")

    print("Mouse: choose action before drawing, then select Calculator")
    browser.click(*browser.center('[data-action="new"]'))
    check(browser.eval(f"{state}.mode") == "armed", "action chosen first")
    browser.drag((300, 310), (690, 590))
    check(browser.eval(f"{state}.windows[0].content") == "picker", "program picker created")
    cx, cy = browser.center(".picker")
    browser.send("Input.dispatchMouseEvent", type="mouseWheel", x=cx, y=cy, deltaX=0, deltaY=120)
    browser.wait_for(f"{state}.windows[0].pickerIndex === 1", label="picker scroll")
    browser.click(*browser.center(".picker button"))
    check(browser.eval(f"{state}.windows[0].content") == "calculator", "selected app mounts")
    for key in ["key-7", "key-times", "key-6", "key-equals"]:
        browser.click(*browser.center(f'[data-surfaceos-window="window-1"] [data-widget-id="{key}"]'))
    display = '[data-surfaceos-window="window-1"] [data-widget-id="display"]'
    check(browser.eval(f"document.querySelector('{display}').textContent") == "42", "widget receives mouse input")

    print("Hand: request actions, draw another window with two hands")
    hand.send(TWO_HAND_HOLD)
    check(dialog_title(browser) == "Open main menu?", "two-hand hold asks for confirmation")
    click_button(browser, "#dialog", "Yes")
    check(browser.eval("[...document.querySelectorAll('#actions button')].map(b => b.textContent).join('|')")
          == "Make Window|Screenshot|New Surface", "main menu offers Make Window, Screenshot, New Surface")
    click_button(browser, "#actions", "Make Window")
    hand.rectangle(TWO_HAND_PINCH_START, .56, .34, .06, .06)
    hand.rectangle(TWO_HAND_PINCH_MOVE, .56, .34, .18, .34)
    hand.rectangle(TWO_HAND_PINCH_END, .56, .34, .18, .34)
    check(browser.wait_for(f"{state}.windows.length === 2", label="second window"),
          "two-hand rectangle creates a second nonoverlapping window")
    browser.click(*browser.center(".surface-window:last-child .picker button"))
    check(browser.eval(f"{state}.windows[1].content") == "notes", "second window selected Notes")
    browser.click(*browser.center("#manage-button"))
    click_button(browser, "#dialog", "Yes")
    click_button(browser, "#dialog", "Move")
    browser.click(*browser.center('[data-window-id="window-2"] .window-header'))
    check(browser.eval(f"{state}.mode") == "move-ready", "one click selects move target")
    before = browser.eval(f"{state}.windows.find(w => w.id === 'window-2').y")
    hx, hy = browser.center('[data-window-id="window-2"] .window-header')
    browser.drag((hx, hy), (hx, hy + 35))
    after = browser.eval(f"{state}.windows.find(w => w.id === 'window-2').y")
    check(after > before, "selected window moves without overlap")
    check(browser.eval(f"{state}.phase") == "workspace", "remains in workspace")

    print("Gestures: hold ring, peace sign, thumbs down, new surface, close surface")
    hand.send(POINTER_MOVE, .5, .5)
    hand.server.publish(encode(SurfaceInputEvent(HOLD_PROGRESS, None, progress=0.6)))
    check(browser.wait_for("getComputedStyle(cursor).getPropertyValue('--hold').trim() === '0.6'", label="hold ring"),
          "hold progress fills the cursor ring")
    check(browser.eval("getComputedStyle(cursor).width") == "15px", "cursor ring is 15px")
    hand.server.publish(encode(SurfaceInputEvent(HOLD_PROGRESS, None, progress=0.0)))

    hand.send(PEACE_SIGN)
    check(dialog_title(browser) == "Manage windows?", "peace sign asks to manage windows")
    click_button(browser, "#dialog", "Yes")
    check(browser.eval("[...document.querySelectorAll('#dialog button')].map(b => b.textContent).join('|')")
          == "Move|Resize|Change surface|Cancel", "manage menu offers Move, Resize, Change surface")
    click_button(browser, "#dialog", "Cancel")

    hand.send(THUMBS_DOWN)
    check(dialog_title(browser) == "Close something?", "thumbs down asks to close something")
    click_button(browser, "#dialog", "Yes")
    click_button(browser, "#dialog", "Window")
    browser.click(*browser.center('[data-window-id="window-1"] .window-header'))
    check(browser.wait_for(f"{state}.windows.length === 1", label="window closed"), "thumbs down closes the picked window")

    browser.click(*browser.center("#actions-button"))
    click_button(browser, "#dialog", "Yes")
    click_button(browser, "#actions", "New Surface")
    check(browser.wait_for(f"{state}.phase === 'calibration'", label="new surface"), "New Surface returns to corner setup")
    check(browser.eval(f"{state}.windows.length") == 1, "existing windows stay during New Surface")
    click_button(browser, "#setup", "Cancel new surface")
    check(browser.wait_for(f"{state}.phase === 'workspace'", label="cancel new surface"), "New Surface can be cancelled")

    browser.click(*browser.center("#close-button"))
    click_button(browser, "#dialog", "Yes")
    click_button(browser, "#dialog", "Surface")
    x, y = surface_point(browser, .9, .9)
    browser.click(x * WIDTH, y * HEIGHT)
    check(dialog_title(browser) == "Close Surface 1?", "picking a surface asks before closing it")
    click_button(browser, "#dialog", "Yes")
    check(browser.wait_for(f"{state}.surfaces.length === 0 && {state}.windows.length === 0", label="surface closed"),
          "closing a surface removes it and its windows")
    check(browser.eval(f"{state}.phase") == "calibration", "with no surfaces left, setup starts again")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--screenshot", type=Path)
    parser.add_argument("--browser")
    args = parser.parse_args()

    executable = args.browser or next((path for path in BROWSERS if os.path.exists(path)), None) or shutil.which("msedge") or shutil.which("chrome")
    if not executable:
        print("No Edge or Chrome found; pass --browser")
        return 2

    http_port, hand_port, debug_port = free_port(), free_port(), free_port()
    http = subprocess.Popen([sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1", "--directory", str(ROOT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    hand_server = SurfaceServer("localhost", hand_port)
    hand_server.start()
    profile = tempfile.mkdtemp(prefix="surfaceos-smoke-")
    chrome = subprocess.Popen([executable, "--headless=new", "--disable-gpu", f"--remote-debugging-port={debug_port}",
                               f"--user-data-dir={profile}", f"--window-size={WIDTH},{HEIGHT}", "--no-first-run", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json") as response:
                    ws_url = next(t["webSocketDebuggerUrl"] for t in json.load(response) if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.1)
        if not ws_url:
            print("Browser did not start")
            return 2
        browser = Browser(ws_url)
        for domain in ["Page", "Runtime", "Log"]:
            browser.send(f"{domain}.enable")
        browser.send("Emulation.setDeviceMetricsOverride", width=WIDTH, height=HEIGHT, deviceScaleFactor=1, mobile=False)
        run(browser, Hand(hand_server), f"http://127.0.0.1:{http_port}", f"ws://localhost:{hand_port}")
        if args.screenshot:
            args.screenshot.write_bytes(base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"]))
            print(f"Screenshot saved to {args.screenshot}")
        browser.eval("0")  # flush pending console events
        if browser.errors:
            print("Console errors:\n  " + "\n  ".join(browser.errors))
            return 1
        print("SMOKE TEST PASSED")
        return 0
    except AssertionError as error:
        print(f"FAILED: {error}")
        return 1
    finally:
        chrome.terminate()
        http.terminate()
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
