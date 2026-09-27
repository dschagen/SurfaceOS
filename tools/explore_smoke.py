"""Browser test of the Explore Object window in the shell, without a camera or an API key.

Runs the real WebSocket server, AI router, object watcher, and GeminiService request code. Camera
frames are synthetic, and the Gemini API is replaced by a stand-in client whose answers are labelled
as test answers in the window, never as live Gemini output.

Run from the repository root:  python tools/explore_smoke.py [--screenshot out.png]
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from integration_smoke import BROWSERS, HEIGHT, ROOT, WIDTH, Browser, Hand, SurfaceServer, check, free_port  # noqa: E402
from youtube_smoke import dialog_choice, open_program  # noqa: E402

from ai.gemini_service import GeminiService  # noqa: E402
from ai.router import AIRouter  # noqa: E402
from vision.object_watch import ObjectWatcher, WatchSettings  # noqa: E402

EX = '[data-surfaceos-window="window-1"]'


def widget(name: str) -> str:
    return f'{EX} [data-widget-id="{name}"]'


class StandInClient:
    """Answers like the Gemini API would, and records what the service asked."""

    def __init__(self):
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"config": config, "text": contents[0]["parts"][-1]["text"]})
        time.sleep(0.2)
        if config.get("response_mime_type") == "application/json":
            return SimpleNamespace(text=json.dumps({"object_present": True, "label": "coffee mug", "confidence": "high",
                                                    "summary": "A dark ceramic mug."}), candidates=[])
        metadata = SimpleNamespace(web_search_queries=["coffee mug"], grounding_chunks=[
            SimpleNamespace(web=SimpleNamespace(uri="https://example.com/mugs", title="Mugs", domain="example.com"))])
        return SimpleNamespace(text="A mug holds hot drinks. Stand-in answer.", candidates=[SimpleNamespace(grounding_metadata=metadata, finish_reason=None)])

    def kinds(self):
        return ["identify" if c["config"].get("response_mime_type") else ("grounded ask" if c["config"].get("tools") else "ask")
                for c in self.calls]


class SyntheticCamera:
    """Feeds 30 fps frames of a grey desk, with or without dark rectangles, to the router."""

    def __init__(self, router: AIRouter):
        self.router = router
        self.objects = []
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.running:
            frame = np.full((240, 320, 3), 120, dtype=np.uint8)
            for x, y, w, h, shade in self.objects:
                frame[int(y * 240):int((y + h) * 240), int(x * 320):int((x + w) * 320)] = shade
            self.router.on_frame(frame, [], time.monotonic())
            time.sleep(1 / 30)


def text_of(browser: Browser, name: str) -> str:
    return browser.eval(f"document.querySelector('{widget(name)}')?.textContent ?? ''")


def wait_text(browser: Browser, name: str, expected: str, timeout: float = 8.0) -> bool:
    return browser.wait_for(f"(document.querySelector('{widget(name)}')?.textContent ?? '').includes({json.dumps(expected)})",
                            timeout=timeout, label=f"{name} shows {expected!r}")


def run(browser: Browser, hand: Hand, client: StandInClient, camera: SyntheticCamera, base_url: str, hand_url: str) -> None:
    browser.send("Page.navigate", url=f"{base_url}/surfaceos-shell/frontend/?hand={hand_url}")
    browser.wait_for("document.readyState === 'complete' && !!window.SurfaceOS", label="shell loaded")
    browser.wait_for("document.querySelector('#hand-status').textContent.includes('connected')", label="hand bridge")
    browser.click(*browser.center("#confirm-surface"))
    browser.click(*browser.center("#finish-setup"))
    dialog_choice(browser, "Align hands")
    for _ in range(4):
        tx, ty = browser.center(".camera-target")
        hand.pinch(tx / WIDTH, ty / HEIGHT)
        time.sleep(0.15)
    browser.wait_for("window.SurfaceOS.getState().phase === 'workspace'", label="workspace")

    print("Open Explore Object from the program picker")
    open_program(browser, (200, 220), (1100, 730), "explore object", 1)
    check(browser.eval("window.SurfaceOS.getState().windows[0].content") == "explore", "window-1 runs Explore Object")
    check(wait_text(browser, "status", "Watching"), "window is watching the camera area")
    time.sleep(1.0)  # the watcher first learns the empty area

    print("An object placed in the area is captured and identified, with no web lookup")
    camera.objects = [(0.40, 0.40, 0.15, 0.18, 30)]
    check(wait_text(browser, "identity", "coffee mug"), "identification shown")
    check(browser.eval(f"document.querySelector('{widget('photo')} img')?.src.startsWith('data:image/jpeg;base64,')"), "captured photo shown")
    check(text_of(browser, "question") == "Analyze further?", "asks before analyzing further")
    check(client.kinds() == ["identify"], "only an identification request so far")
    check("Test answer, not from Gemini" in text_of(browser, "footer"), "stand-in output is not labelled as live Gemini")
    time.sleep(1.5)
    check(client.kinds() == ["identify"], "the same stationary object is not submitted again")

    print("No returns to watching; a new object is captured")
    browser.click(*browser.center(widget("no")))
    check(wait_text(browser, "heading", "Place an object"), "No returns to watching")
    time.sleep(1.5)
    check(client.kinds() == ["identify"], "the dismissed object still in view is not resubmitted")
    camera.objects = []
    time.sleep(1.5)
    camera.objects = [(0.30, 0.30, 0.12, 0.12, 220)]
    browser.wait_for(f"!!document.querySelector('{widget('yes')}')", timeout=10, label="second identification")
    check(client.kinds() == ["identify", "identify"], "a different object is identified")

    print("Hand: pinch Yes; the lookup uses the image and Google Search")
    yx, yy = browser.center(widget("yes"))
    hand.pinch(yx / WIDTH, yy / HEIGHT)
    check(wait_text(browser, "details", "A mug holds hot drinks."), "hand pinch on Yes shows the lookup")
    check(client.kinds()[-1] == "grounded ask", "Yes sends a grounded request")
    check("identified as: coffee mug" in client.calls[-1]["text"], "the lookup includes the identified object")
    check(text_of(browser, "source-0") == "example.com", "source link shown")

    print("Mouse: a follow-up question keeps the context")
    browser.click(*browser.center(widget("suggest-0")))
    check(wait_text(browser, "details", "You: What is it made of?"), "follow-up question shown")
    browser.wait_for(f"!document.querySelector('{widget('ask')}').classList.contains('surfaceos-widget--disabled')", label="answered")
    check("Conversation so far" in client.calls[-1]["text"], "the follow-up carries the earlier answer")

    print("Object leaving, pause, resume, and manual analysis")
    camera.objects = []
    check(wait_text(browser, "footer", "The object left the camera area"), "object leaving is shown and the photo stays")
    browser.click(*browser.center(widget("new-object")))
    browser.click(*browser.center(widget("pause")))
    check(wait_text(browser, "status", "Paused"), "Pause")
    count = len(client.calls)
    camera.objects = [(0.55, 0.30, 0.12, 0.2, 60)]
    time.sleep(2.0)
    check(len(client.calls) == count, "no capture while paused")
    browser.click(*browser.center(widget("pause")))
    check(wait_text(browser, "status", "Watching"), "Resume")
    browser.click(*browser.center(widget("analyze")))
    browser.wait_for(f"!!document.querySelector('{widget('yes')}')", timeout=10, label="manual identification")
    check(client.kinds()[-1] == "identify", "Analyze this frame captures and identifies on demand")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    executable = next((path for path in BROWSERS if os.path.exists(path)), None)
    if not executable:
        print("No Edge or Chrome found")
        return 2
    http_port, hand_port, debug_port = free_port(), free_port(), free_port()
    http = subprocess.Popen([sys.executable, "-m", "http.server", str(http_port), "--bind", "127.0.0.1", "--directory", str(ROOT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    client = StandInClient()
    router_ref = {}
    server = SurfaceServer("localhost", hand_port, on_message=lambda c, m: router_ref["r"].handle(c, m),
                           on_close=lambda c: router_ref["r"].client_closed(c))
    router = AIRouter(GeminiService("stand-in-model", client=client, provider="test-double"), server.send_to,
                      ObjectWatcher(WatchSettings(cooldown_s=1.0)))
    router_ref["r"] = router
    server.start()
    camera = SyntheticCamera(router)
    profile = tempfile.mkdtemp(prefix="surfaceos-explore-")
    browser_process = subprocess.Popen([executable, "--headless=new", f"--remote-debugging-port={debug_port}",
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
        browser = Browser(ws_url)
        for domain in ["Page", "Runtime", "Log"]:
            browser.send(f"{domain}.enable")
        browser.send("Emulation.setDeviceMetricsOverride", width=WIDTH, height=HEIGHT, deviceScaleFactor=1, mobile=False)
        run(browser, Hand(server), client, camera, f"http://127.0.0.1:{http_port}", f"ws://localhost:{hand_port}")
        if args.screenshot:
            args.screenshot.write_bytes(base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"]))
        browser.eval("0")
        own = [e for e in browser.errors if "favicon" not in e and "8766" not in e]
        if own:
            print("Console errors:\n  " + "\n  ".join(own))
            return 1
        print("EXPLORE SMOKE TEST PASSED")
        return 0
    except AssertionError as error:
        print(f"FAILED: {error}")
        print("DEBUG calls:", client.kinds(), "watcher state:", router.watcher.state)
        print("DEBUG window:", browser.eval(f"document.querySelector('{EX}')?.innerText"))
        print("DEBUG errors:", browser.errors)
        return 1
    finally:
        camera.running = False
        browser_process.terminate()
        http.terminate()
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
