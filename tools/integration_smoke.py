"""End-to-end smoke test of the shell, widget renderer, and hand-input transport together.

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

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from input.events import (POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE,  # noqa: E402
                          POINTER_UP, Pointer, SurfaceInputEvent)
from server.protocol import encode, hands_debug_message  # noqa: E402
from server.server import SurfaceServer  # noqa: E402

# The hand service no longer sends this one-hand event; the shell still creates windows with it.
# Replace with the two-hand events once the shell supports them.
DOUBLE_PINCH = "double_pinch"

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
        self.send(POINTER_DOWN)
        self.send(POINTER_UP)

    def hands(self, hands: list[tuple[int, float, float, bool, bool]]) -> None:
        """Sends the debug snapshot of tracked hands: (id, x, y, pinching, primary)."""
        pointers = [Pointer(id=hand_id, x=x, y=y, is_down=pinching, gesture="None") for hand_id, x, y, pinching, _ in hands]
        primary = next((hand_id for hand_id, *_, is_primary in hands if is_primary), None)
        self.server.publish(hands_debug_message(pointers, primary))
        time.sleep(0.1)


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def run(browser: Browser, hand: Hand, base_url: str, hand_url: str) -> None:
    browser.send("Page.navigate", url=f"{base_url}/surfaceos-shell/frontend/?hand={hand_url}")
    browser.wait_for("document.readyState === 'complete' && !!window.SurfaceOS", label="shell loaded")
    browser.wait_for("document.querySelector('.menu-app-grid [data-content=\"calculator\"]') !== null", label="apps in menu")
    browser.wait_for("document.querySelector('#hand-status').textContent.includes('connected')", label="hand bridge connected")
    state = "window.SurfaceOS.getState()"

    def to_canvas(point):
        return point[0] / WIDTH, point[1] / HEIGHT

    print("Hand: shell buttons outside windows respond to a pinch")
    hand.pinch(*to_canvas(browser.center("#welcome-create")))
    check(browser.wait_for(f"{state}.mode === 'armed'", timeout=2, label="armed after hand pinch on Create a window"),
          "hand pinch on 'Create a window' arms window creation")
    browser.eval("window.SurfaceOS.reset()")
    hand.pinch(*to_canvas(browser.center("#new-window")))
    check(browser.wait_for(f"{state}.mode === 'armed'", timeout=2, label="armed after hand pinch on New window"),
          "hand pinch on '+ New window' arms window creation")
    browser.eval("window.SurfaceOS.reset()")

    print("Mouse: create a window, choose Calculator, compute 7 x 6")
    browser.double_click(300, 250)
    check(browser.eval(f"{state}.mode") == "armed", "double-click arms window creation")
    browser.drag((200, 150), (700, 600))
    check(browser.eval(f"{state}.mode") == "choosing", "drag opens the content menu")
    browser.click(*browser.center('#content-menu [data-content="calculator"]'))
    check(browser.eval(f"{state}.windows.map(w => w.content).join()") == "calculator", "window-1 runs the calculator")
    for key in ["key-7", "key-times", "key-6", "key-equals"]:
        browser.click(*browser.center(f'[data-surfaceos-window="window-1"] [data-widget-id="{key}"]'))
    display = '[data-surfaceos-window="window-1"] [data-widget-id="display"]'
    check(browser.eval(f"document.querySelector('{display}').textContent") == "42", "mouse presses on widgets give 42")

    print("Mouse: second window through the layout contract (Workspace -> Open notes action)")
    browser.click(*browser.center("#new-window"))
    browser.drag((900, 150), (1450, 600))
    browser.click(*browser.center('#content-menu [data-content="workspace"]'))
    notes_button = '[data-surfaceos-window="window-2"] [data-widget-id="notes"]'
    check(browser.eval(f"!!document.querySelector('{notes_button}.surfaceos-widget--button')"), "workspace layout drawn by the widget renderer")
    browser.click(*browser.center(notes_button))
    check(browser.wait_for(f"{state}.windows.find(w => w.id === 'window-2')?.content === 'notes'", label="notes"), "widget action reached the shell and opened Notes")
    check(browser.eval(f"document.querySelector('{display}').textContent") == "42", "window-1 kept its state through shell re-renders")

    print("Hand: double pinch, drag a third window, pick Timer by pinching the menu")
    start, end = (0.05, 0.69), (0.40, 0.91)
    hand.pinch(*start)                      # first pinch of the double pinch
    hand.send(DOUBLE_PINCH)
    hand.send(POINTER_DOWN)                 # second pinch stays down and draws
    browser.wait_for(f"{state}.mode === 'drawing'", label="hand drawing")
    hand.move(*end, steps=15)
    hand.send(POINTER_UP)
    check(browser.wait_for(f"{state}.mode === 'choosing'", label="menu after hand draw"), "hand drag opens the content menu")

    hand.pinch(*to_canvas(browser.center('#content-menu [data-content="timer"]')))
    check(browser.wait_for(f"{state}.windows.length === 3 && {state}.windows[2].content === 'timer'", label="timer window"), "hand pinch on the menu created a Timer window")

    tab = '[data-surfaceos-window="window-3"] [data-widget-id="tab-timer"]'
    browser.wait_for(f"!!document.querySelector('{tab}')", label="timer tab")
    hand.pinch(*to_canvas(browser.center(tab)))
    check(browser.wait_for(f"document.querySelector('{tab}').classList.contains('surfaceos-v-selected')", label="tab selected"), "hand pinch activated a widget")

    other = '[data-surfaceos-window="window-3"] [data-widget-id="tab-stopwatch"]'
    hand.move(*to_canvas(browser.center(other)))
    hand.send(POINTER_DOWN)
    hand.send(POINTER_CANCEL)
    hand.move(0.5, 0.5)
    time.sleep(0.3)
    check(browser.eval(f"document.querySelector('{tab}').classList.contains('surfaceos-v-selected')"), "lost tracking mid-press did not activate the widget")
    check(browser.eval("document.querySelectorAll('.surfaceos-widget--pressed').length") == 0, "no widget left pressed after pointer_cancel")
    check(browser.eval(f"document.querySelector('{display}').textContent") == "42", "earlier windows are unaffected")

    print("Hand: one activation per pinch, carrying the right window id")
    # App actions are reported to the shell through console.debug('SurfaceOS app action', action).
    browser.eval("""window.__actions = []; (() => { const original = console.debug;
        console.debug = (...args) => { if (args[0] === 'SurfaceOS app action') window.__actions.push(args[1]); original(...args); }; })()""")
    key = '[data-surfaceos-window="window-1"] [data-widget-id="key-9"]'
    kx, ky = to_canvas(browser.center(key))
    hand.move(kx, ky)
    hand.send(POINTER_DOWN)
    for dx in (0.002, -0.002, 0.001, 0.0, 0.002):   # held pinch drifting a little over the button
        hand.send(POINTER_MOVE, kx + dx, ky)
    hand.send(POINTER_UP, kx, ky)
    time.sleep(0.2)
    actions = browser.eval("window.__actions")
    check([(a["window_id"], a["widget_id"]) for a in actions] == [("window-1", "key-9")],
          "press, movement while held, and release activate the window-1 button exactly once")
    hand.pinch(*to_canvas(browser.center(other)))
    time.sleep(0.2)
    actions = browser.eval("window.__actions")
    check([(a["window_id"], a["widget_id"]) for a in actions][-1] == ("window-3", "tab-stopwatch"),
          "a pinch on the window-3 button reports window-3")

    print("Hand: two quick pinches on a window button are two presses, not window creation")
    one = '[data-surfaceos-window="window-1"] [data-widget-id="key-1"]'
    ox, oy = to_canvas(browser.center(one))
    hand.pinch(ox, oy)
    hand.send(DOUBLE_PINCH)                  # the tracker reports the quick second pinch as a double pinch
    hand.send(POINTER_DOWN)
    hand.send(POINTER_UP)
    time.sleep(0.2)
    check(browser.eval(f"{state}.mode") == "idle", "a double pinch over a window does not arm window creation")
    check(browser.eval(f"document.querySelector('{display}').textContent") == "911", "both pinches pressed the button")

    print("Mouse and hand: move and resize still work")
    bounds = f"{state}.windows.find(w => w.id === 'window-2')"
    before = browser.eval(bounds)
    hx, hy = browser.center('[data-window-id="window-2"] .window-header')
    browser.drag((hx - 60, hy), (hx - 60 - 80, hy + 40))
    after = browser.eval(bounds)
    check(abs(after["x"] - (before["x"] - 80 / WIDTH)) < 0.003 and abs(after["y"] - (before["y"] + 40 / HEIGHT)) < 0.003,
          "mouse drag on the title bar moves the window")
    rx, ry = browser.center('[data-window-id="window-2"] .resize-handle')
    browser.drag((rx, ry), (rx - 100, ry - 50))
    resized = browser.eval(bounds)
    check(abs(resized["width"] - (after["width"] - 100 / WIDTH)) < 0.003 and abs(resized["height"] - (after["height"] - 50 / HEIGHT)) < 0.003,
          "mouse drag on the corner resizes the window")
    hx, hy = to_canvas(browser.center('[data-window-id="window-2"] .window-header'))
    hand.move(hx - 0.03, hy)
    hand.send(POINTER_DOWN)
    hand.move(hx - 0.03 + 0.05, hy + 0.02, steps=6)
    hand.send(POINTER_UP)
    moved = browser.eval(bounds)
    check(abs(moved["x"] - (resized["x"] + 0.05)) < 0.003 and abs(moved["y"] - (resized["y"] + 0.02)) < 0.003,
          "hand pinch-drag on the title bar moves the window")
    check(browser.eval(f"{state}.mode") == "idle", "shell is idle after the drags")

    print("Hand debug bubbles")
    hand.hands([(0, 0.30, 0.40, False, True), (1, 0.70, 0.60, True, False)])
    bubbles = "[...document.querySelectorAll('.hand-bubble:not([hidden])')]"
    check(browser.wait_for(f"{bubbles}.length === 2", timeout=2, label="two bubbles"), "one bubble per tracked hand")
    check(browser.eval(f"new Set({bubbles}.map(b => b.dataset.color)).size") == 2, "bubbles look different per hand")
    check(browser.eval(f"{bubbles}.map(b => b.classList.contains('pinching')).join()") == "false,true", "pinching hand's bubble changes")
    check(browser.eval("getComputedStyle(document.querySelector('.hand-bubble')).pointerEvents") == "none", "bubbles cannot block clicks")
    placed = browser.eval(f"""{bubbles}.map(b => {{ const r = b.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
        return [(r.left + r.width / 2 - s.left) / s.width, (r.top + r.height / 2 - s.top) / s.height]; }})""")
    check(all(abs(a - b) < 0.002 for got, want in zip(placed, [(0.30, 0.40), (0.70, 0.60)]) for a, b in zip(got, want)),
          "bubbles sit at the canvas position used for hit testing")
    hand.hands([(0, 0.30, 0.40, False, True)])
    check(browser.wait_for(f"{bubbles}.length === 1", timeout=2, label="one bubble"), "a lost hand's bubble hides")
    hand.hands([])
    check(browser.wait_for(f"{bubbles}.length === 0", timeout=2, label="no bubbles"), "all bubbles hide when no hands are tracked")


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
