"""Browser test of Ask AI in the shell: thumbs-up, Voice or Screenshot, placement, cropping, voice chat.

Runs the real shell, WebSocket server, hand-event encoder, marker calibration, AI router, and
GeminiService request code. The Gemini API is replaced by a stand-in client whose answers are
labelled as test answers, the browser's speech engines are replaced by scripted fakes, and camera
frames for the desk photo are synthetic. No camera, microphone, or API key is needed.

Run from the repository root:  python tools/assistant_smoke.py [--screenshot out.png]
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

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from integration_smoke import (BROWSERS, HEIGHT, ROOT, WIDTH, Browser, Hand, SurfaceServer,  # noqa: E402
                               answer_calibration, check, free_port, surface_point)
from youtube_smoke import dialog_choice  # noqa: E402

from ai.gemini_service import GeminiService  # noqa: E402
from ai.router import AIRouter  # noqa: E402
from input.events import THUMBS_DOWN, THUMBS_UP  # noqa: E402

STATE = "window.SurfaceOS.getState()"
# Set by --shots: a folder for screenshots of the key moments, for a visual check.
SHOTS: Path | None = None


def snap(browser: Browser, name: str) -> None:
    if SHOTS is not None:
        (SHOTS / f"{name}.png").write_bytes(base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"]))

# Replaces the browser's speech recognition and synthesis before any page script runs.
FAKE_SPEECH = """
(() => {
  const state = { recognizers: [], spoken: [] };
  class FakeRecognition {
    constructor() { this.running = false; state.recognizers.push(this); }
    start() { this.running = true; }
    abort() { this.running = false; setTimeout(() => this.onend && this.onend(), 0); }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u) { state.spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 50); },
    cancel() {},
  } });
  state.listening = () => state.recognizers.some((r) => r.running);
  state.say = (words) => {
    const r = state.recognizers.find((x) => x.running);
    if (!r) return false;
    const result = [{ transcript: words }];
    result.isFinal = true;
    r.onresult({ resultIndex: 0, results: [result] });
    return true;
  };
  window.__speech = state;
})();
"""


class StandInClient:
    """Answers like the Gemini API would, and records what the service asked."""

    def __init__(self):
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        parts = contents[0]["parts"]
        image = next((part["inline_data"]["data"] for part in parts if "inline_data" in part), None)
        self.calls.append({"config": config, "text": parts[-1]["text"], "image": image})
        time.sleep(0.1)
        if "one sentence" in parts[-1]["text"]:
            words = "A white card on a grey desk."
        else:
            words = "Stand-in answer: it is a white card."
        return SimpleNamespace(text=words, candidates=[])

    def kinds(self):
        return ["describe" if "one sentence" in c["text"] else "ask" for c in self.calls]


class SyntheticCamera:
    """Feeds 30 fps frames of a grey desk with a white card to the router, for desk photos."""

    def __init__(self, router: AIRouter):
        self.router = router
        self.running = True
        self.frame = np.full((720, 1280, 3), 95, dtype=np.uint8)
        self.frame[260:460, 520:760] = 245
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.running:
            self.router.on_frame(self.frame, time.monotonic())
            time.sleep(1 / 30)


def px(point: tuple[float, float]) -> tuple[float, float]:
    """Page pixels for a normalized page point, for mouse input."""
    return point[0] * WIDTH, point[1] * HEIGHT


def pinch_button(browser: Browser, hand: Hand, container: str, text: str) -> None:
    """Pinches, with the hand, the visible button with this text."""
    point = browser.wait_for(f"""(() => {{ const b = [...document.querySelectorAll({json.dumps(container + ' button')})]
        .find(e => e.textContent.trim() === {json.dumps(text)} && e.offsetParent);
        if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()""",
                             label=f"button {text}")
    hand.pinch(point[0] / WIDTH, point[1] / HEIGHT)


def widget(window_id: str, name: str) -> str:
    return f'[data-surfaceos-window="{window_id}"] [data-widget-id="{name}"]'


def text_of(browser: Browser, window_id: str, name: str) -> str:
    return browser.eval(f"document.querySelector('{widget(window_id, name)}')?.textContent ?? ''")


def run(browser: Browser, hand: Hand, client: StandInClient, base_url: str, hand_url: str) -> None:
    browser.send("Page.addScriptToEvaluateOnNewDocument", source=FAKE_SPEECH)
    browser.send("Page.navigate", url=f"{base_url}/surfaceos-shell/frontend/?hand={hand_url}")
    browser.wait_for("document.readyState === 'complete' && !!window.SurfaceOS && !!window.__speech", label="shell loaded")
    browser.wait_for("document.querySelector('#hand-status').textContent.includes('connected')", label="hand bridge")

    print("Setup: one surface, marker calibration, then the C and OK holds")
    browser.click(*browser.center("#confirm-surface"))
    browser.click(*browser.center("#finish-setup"))
    dialog_choice(browser, "Align hands")
    browser.wait_for("!!document.querySelector('.marker-plane')", label="markers")
    check(answer_calibration(browser, hand)["ok"], "markers found")
    browser.wait_for(f"{STATE}.phase === 'finger'", label="fingertip step")
    hand.dwell(*surface_point(browser, .5, .5))
    browser.wait_for(f"{STATE}.phase === 'camera-check'", label="check step")
    hand.dwell(*surface_point(browser, .5, .22))
    check(browser.wait_for(f"{STATE}.phase === 'workspace'", label="workspace"), "calibrated and in the workspace")

    print("Thumbs-up opens Ask AI next to the hand; thumbs-down backs out")
    hx, hy = surface_point(browser, .3, .6)
    hand.send(THUMBS_UP, hx, hy)
    check(browser.wait_for(f"{STATE}.assist === 'prompt' && document.querySelector('#dialog h2').textContent === 'Ask AI'",
                           label="Ask AI prompt"), "thumbs-up opens the Ask AI prompt")
    box = browser.eval("(() => { const r = document.querySelector('#dialog').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
    near = box[0] - 40 <= hx * WIDTH <= box[2] + 40 and (abs(box[3] - hy * HEIGHT) < 80 or abs(box[1] - hy * HEIGHT) < 80)
    check(near, "the prompt sits next to the hand")
    snap(browser, "1-prompt")
    options = browser.eval("[...document.querySelectorAll('#dialog button')].map(b => b.textContent)")
    check(options == ["Voice", "Screenshot", "Cancel"], "it offers Voice, Screenshot, and Cancel")
    before = browser.eval("document.querySelector('#dialog').style.left + ',' + document.querySelector('#dialog').style.top")
    hand.send(THUMBS_UP, *surface_point(browser, .7, .4))
    time.sleep(0.3)
    after = browser.eval("document.querySelector('#dialog').style.left + ',' + document.querySelector('#dialog').style.top")
    check(browser.eval(f"{STATE}.assist") == "prompt" and after == before, "a second thumbs-up while the prompt is open changes nothing")
    hand.send(THUMBS_DOWN, hx, hy)
    check(browser.wait_for(f"{STATE}.assist === null && document.querySelector('#dialog').hidden", label="cancelled"),
          "thumbs-down cancels the prompt")

    print("Voice: pinch Voice, draw where the chat goes, then talk")
    hand.send(THUMBS_UP, hx, hy)
    browser.wait_for(f"{STATE}.assist === 'prompt'", label="prompt again")
    pinch_button(browser, hand, "#dialog", "Voice")
    check(browser.wait_for(f"{STATE}.assist === 'placing' && {STATE}.mode === 'armed'", label="placing"),
          "a hand pinch on Voice asks where the chat goes")
    browser.drag(px(surface_point(browser, .03, .05)), px(surface_point(browser, .48, .55)))
    check(browser.wait_for(f"{STATE}.windows.some(w => w.content === 'assistant')", label="chat window"),
          "drawing the rectangle opens the Ask AI chat there")
    chat = browser.eval(f"{STATE}.windows.find(w => w.content === 'assistant').id")
    check(browser.wait_for("window.__speech.listening()", label="listening"), "the chat starts listening")
    browser.eval("window.__speech.say('What is on my desk?')")
    check(browser.wait_for(f"(document.querySelector('{widget(chat, 'transcript')}')?.textContent ?? '').includes('Stand-in answer')",
                           timeout=8, label="answer"), "a spoken question gets an answer in the transcript")
    config = client.calls[-1]["config"]
    check("spoken aloud" in config["system_instruction"] and config.get("tools") == [{"google_search": {}}],
          "the question asks Gemini for a short spoken answer and allows web search")
    check(browser.wait_for("window.__speech.spoken.includes('Stand-in answer: it is a white card.')", label="spoken"),
          "the answer is read aloud")
    check(browser.wait_for("window.__speech.listening()", label="listening again"), "listening resumes after the answer")
    snap(browser, "2-voice-chat")
    check("Test answers, not from Gemini" in text_of(browser, chat, "footer"), "stand-in answers are not labelled as live Gemini")

    print("Screenshot: the desk photo is taken with the projection blanked, then placed and cropped")
    hand.send(THUMBS_UP, *surface_point(browser, .75, .5))
    browser.wait_for(f"{STATE}.assist === 'prompt'", label="prompt for screenshot")
    pinch_button(browser, hand, "#dialog", "Screenshot")
    dark = None
    deadline = time.monotonic() + 3
    while dark is None and time.monotonic() < deadline:
        if browser.eval("document.querySelector('#stage').classList.contains('ai-capture')"):
            shot = base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"])
            image = cv2.imdecode(np.frombuffer(shot, np.uint8), cv2.IMREAD_GRAYSCALE)
            dark = float(image.mean())
    check(dark is not None and dark < 3, f"the projection is black while the photo is taken (mean brightness {dark})")
    check(browser.wait_for(f"{STATE}.assist === 'placing'", timeout=6, label="photo taken"), "the photo is taken before placing")
    check(not browser.eval("document.querySelector('#stage').classList.contains('ai-capture')"), "the projection comes back")
    browser.drag(px(surface_point(browser, .52, .05)), px(surface_point(browser, .97, .95)))
    browser.wait_for(f"{STATE}.windows.filter(w => w.content === 'assistant').length === 2", label="second chat")
    photo_chat = browser.eval(f"{STATE}.windows.filter(w => w.content === 'assistant')[1].id")
    check(browser.wait_for(f"document.querySelector('{widget(photo_chat, 'photo')} img')?.src.startsWith('data:image/jpeg')",
                           label="photo shown"), "the desk photo appears in the new chat window")
    check(browser.eval(f"{STATE}.windows.find(w => w.id === '{photo_chat}').launch.capture.width") == 1280,
          "the whole camera frame was captured")
    hand.send(THUMBS_UP, *surface_point(browser, .3, .7))
    time.sleep(0.3)
    check(browser.eval(f"{STATE}.assist") is None, "a thumbs-up is ignored while a photo is being cropped")
    snap(browser, "3-crop")

    # Drag over the white card: it spans x 520-760 and y 260-460 of the 1280x720 photo.
    left, top, right, bottom = browser.eval(f"(() => {{ const r = document.querySelector('{widget(photo_chat, 'photo')}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }})()")
    start = (left + (right - left) * 400 / 1280, top + (bottom - top) * 200 / 720)
    end = (left + (right - left) * 880 / 1280, top + (bottom - top) * 520 / 720)
    browser.drag(start, end)
    browser.wait_for(f"!document.querySelector('{widget(photo_chat, 'use-selection')}').classList.contains('surfaceos-widget--disabled')",
                     label="selection")
    browser.click(*browser.center(widget(photo_chat, "use-selection")))
    check(browser.wait_for(f"(document.querySelector('{widget(photo_chat, 'transcript')}')?.textContent ?? '').includes('A white card')",
                           timeout=8, label="description"), "Gemini describes the cropped area")
    described = client.calls[-1]
    crop = cv2.imdecode(np.frombuffer(described["image"], np.uint8), cv2.IMREAD_COLOR)
    check(crop is not None and 330 <= crop.shape[1] <= 630 and 200 <= crop.shape[0] <= 440,
          f"only the selected area was sent ({crop.shape[1]}x{crop.shape[0]} of 1280x720)")
    check(browser.wait_for("window.__speech.spoken.includes('A white card on a grey desk.')", label="description spoken"),
          "the description is read aloud")
    check(browser.wait_for(f"document.querySelector('{widget(photo_chat, 'status')}').textContent === 'Listening...'", label="photo chat listening"),
          "the voice chat about the photo starts listening")
    check(text_of(browser, chat, "status") == "Paused: another chat is listening", "only the newest chat listens")
    browser.eval("window.__speech.say('What is written on it?')")
    browser.wait_for(f"(document.querySelector('{widget(photo_chat, 'transcript')}')?.textContent ?? '').includes('What is written on it?')",
                     label="question")
    browser.wait_for(f"document.querySelector('{widget(photo_chat, 'transcript')}').textContent.includes('Stand-in answer')",
                     timeout=8, label="photo answer")
    check(client.calls[-1]["image"] == described["image"], "follow-up questions are about the same cropped photo")
    snap(browser, "4-photo-chat")

    print("Backing out of cropping, and the program picker fallback")
    browser.eval(f"window.SurfaceOS.closeWindow('{chat}')")
    hand.send(THUMBS_UP, *surface_point(browser, .25, .5))
    browser.wait_for(f"{STATE}.assist === 'prompt'", label="third prompt")
    browser.click(*browser.center("#dialog button:nth-child(2)"))
    browser.wait_for(f"{STATE}.assist === 'placing'", timeout=6, label="third photo")
    browser.drag(px(surface_point(browser, .03, .05)), px(surface_point(browser, .48, .9)))
    browser.wait_for(f"{STATE}.windows.filter(w => w.content === 'assistant').length === 2", label="crop window")
    cropping = browser.eval(f"{STATE}.windows.filter(w => w.content === 'assistant').at(-1).id")
    hand.send(THUMBS_DOWN, *surface_point(browser, .25, .5))
    check(browser.wait_for(f"!{STATE}.windows.some(w => w.id === '{cropping}')", label="closed"),
          "thumbs-down while cropping closes that chat")
    check(browser.eval("document.querySelector('#dialog').hidden"), "without opening the close menu")
    browser.eval(f"window.SurfaceOS.closeWindow('{photo_chat}')")
    browser.click(*browser.center("#actions-button"))
    dialog_choice(browser, "Yes")
    browser.click(*browser.center('[data-action="new"]'))
    browser.drag(px(surface_point(browser, .05, .05)), px(surface_point(browser, .6, .9)))
    picker_id = browser.wait_for(f"{STATE}.windows.find(w => w.content === 'picker')?.id", label="picker")
    picker = f'[data-window-id="{picker_id}"] .picker'
    for _ in range(20):
        if "Ask AI" in browser.eval(f"document.querySelector('{picker} strong').textContent"):
            break
        browser.click(*browser.center(f"{picker} .picker-step"))
    browser.click(*browser.center(f"{picker} .picker-confirm"))
    picked = browser.wait_for(f"{STATE}.windows.find(w => w.content === 'assistant')?.id", label="picker Ask AI")
    check(text_of(browser, picked, "title") == "Ask AI", "the program picker opens Ask AI with its own Voice / Screenshot choice")
    browser.click(*browser.center(widget(picked, "voice")))
    check(browser.wait_for(f"document.querySelector('{widget(picked, 'status')}')?.textContent === 'Listening...'", label="picker voice"),
          "choosing Voice there starts the chat without drawing again")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--screenshot", type=Path)
    parser.add_argument("--shots", type=Path, help="folder for screenshots of the key moments")
    args = parser.parse_args()
    global SHOTS
    SHOTS = args.shots
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
    executable = next((path for path in BROWSERS if os.path.exists(path)), None)
    if not executable:
        print("No Edge or Chrome found")
        return 2
    http_port, hand_port, debug_port = free_port(), free_port(), free_port()
    http = subprocess.Popen([sys.executable, str(ROOT / "tools" / "dev_server.py"), str(http_port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    client = StandInClient()
    router_ref = {}
    server = SurfaceServer("localhost", hand_port, on_message=lambda c, m: router_ref["r"].handle(c, m),
                           on_close=lambda c: router_ref["r"].client_closed(c))
    router = AIRouter(GeminiService("stand-in-model", client=client, provider="test-double"), server.send_to)
    router_ref["r"] = router
    server.start()
    camera = SyntheticCamera(router)
    profile = tempfile.mkdtemp(prefix="surfaceos-askai-")
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
        run(browser, Hand(server), client, f"http://127.0.0.1:{http_port}", f"ws://localhost:{hand_port}")
        if args.screenshot:
            args.screenshot.write_bytes(base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"]))
        browser.eval("0")
        own = [e for e in browser.errors if "favicon" not in e and "8766" not in e]
        if own:
            print("Console errors:\n  " + "\n  ".join(own))
            return 1
        print("ASK AI SMOKE TEST PASSED")
        return 0
    except AssertionError as error:
        print(f"FAILED: {error}")
        return 1
    finally:
        camera.running = False
        browser_process.terminate()
        http.terminate()
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
