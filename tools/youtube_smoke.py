"""Browser test of the YouTube window app inside the shell, against the real YouTube player.

Uses native mouse input through the DevTools protocol, plus hand pinches through the real
SurfaceServer. Needs an internet connection, Edge or Chrome, and the `websockets` package.

Run from the repository root:  python tools/youtube_smoke.py [--screenshot out.png]
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from integration_smoke import (BROWSERS, HEIGHT, ROOT, WIDTH, Browser, Hand, SurfaceServer,  # noqa: E402
                               check, free_port)

YT = '[data-surfaceos-window="window-1"]'


def widget(name: str) -> str:
    return f'{YT} [data-widget-id="{name}"]'


def label(browser: Browser, name: str) -> str:
    return browser.eval(f"document.querySelector('{widget(name)}')?.textContent ?? ''")


def seconds_shown(browser: Browser) -> int:
    shown = label(browser, "time").split("/")[0].strip()
    parts = [int(p) for p in shown.split(":")]
    return parts[-1] + 60 * parts[-2] + (3600 * parts[-3] if len(parts) > 2 else 0)


def type_text(browser: Browser, value: str) -> None:
    browser.click(*browser.center(widget("url")))
    # Ctrl+A first, so the new text replaces anything left in the field.
    browser.send("Input.dispatchKeyEvent", type="keyDown", key="a", code="KeyA", modifiers=2,
                 windowsVirtualKeyCode=65, commands=["selectAll"])
    browser.send("Input.dispatchKeyEvent", type="keyUp", key="a", code="KeyA", modifiers=2, windowsVirtualKeyCode=65)
    browser.send("Input.insertText", text=value)
    browser.send("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13)
    browser.send("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13)


def wait_playing(browser: Browser, timeout: float = 20) -> bool:
    browser.wait_for(f"document.querySelector('{widget('play')}')?.textContent === 'Pause'", timeout=timeout, label="playing")
    start = seconds_shown(browser)
    deadline = time.time() + 6
    while time.time() < deadline:
        if seconds_shown(browser) > start:
            return True
        time.sleep(0.3)
    return False


def run(browser: Browser, hand: Hand, base_url: str, hand_url: str) -> None:
    state = "window.SurfaceOS.getState()"
    browser.send("Page.navigate", url=f"{base_url}/surfaceos-shell/frontend/?hand={hand_url}")
    browser.wait_for("document.readyState === 'complete' && !!window.SurfaceOS", label="shell loaded")
    browser.wait_for("document.querySelector('#hand-status').textContent.includes('connected')", label="hand bridge")

    print("Mouse: open a YouTube window")
    browser.double_click(300, 250)
    browser.drag((120, 110), (900, 640))
    browser.click(*browser.center('#content-menu [data-content="youtube"]'))
    check(browser.eval(f"{state}.windows[0].content") == "youtube", "window-1 runs the YouTube app")
    browser.wait_for(f"!!document.querySelector('{widget('player')} iframe')", timeout=20, label="YouTube iframe")
    check(browser.wait_for(f"!document.querySelector('{widget('play')}').classList.contains('surfaceos-widget--disabled')",
                           timeout=25, label="player ready"), "official IFrame player loaded and ready")
    src = browser.eval(f"document.querySelector('{widget('player')} iframe').src")
    check("youtube.com/embed/aqz-KE-bpKQ" in src, "demo video cued in the embed")

    print("Mouse: SurfaceOS controls drive the player")
    browser.click(*browser.center(widget("play")))
    check(wait_playing(browser), "Play starts the video and the clock advances")
    muted_fallback = "Muted" in label(browser, "time")
    browser.eval(f"window.__ytFrame = document.querySelector('{widget('player')} iframe')")

    print("Mouse: a second app, move, and resize leave the player alone")
    browser.click(*browser.center("#new-window"))
    browser.drag((980, 120), (1500, 560))
    browser.click(*browser.center('#content-menu [data-content="calculator"]'))
    check(browser.eval(f"{state}.windows.length") == 2, "second window opened")
    same_frame = f"window.__ytFrame.isConnected && document.querySelector('{widget('player')} iframe') === window.__ytFrame"
    check(browser.eval(same_frame), "opening another app kept the same player iframe")
    check(wait_playing(browser, 5), "video still playing after the second window opened")
    before = browser.eval("window.__ytFrame.getBoundingClientRect().width")
    hx, hy = browser.center('[data-window-id="window-1"] .window-header')
    browser.drag((hx - 100, hy), (hx - 60, hy + 30))
    rx, ry = browser.center('[data-window-id="window-1"] .resize-handle')
    browser.drag((rx, ry), (rx - 220, ry - 120))
    after = browser.eval("window.__ytFrame.getBoundingClientRect().width")
    check(browser.eval(same_frame) and after < before - 50, "move and resize kept the player and it followed the window")
    check(wait_playing(browser, 5), "video still playing after move and resize")
    browser.click(*browser.center('[data-window-id="window-2"] .window-close'))
    check(browser.eval(same_frame), "closing the other window kept the player")

    print("Mouse: pause, restart, volume")
    browser.click(*browser.center(widget("play")))
    check(browser.wait_for(f"document.querySelector('{widget('play')}').textContent === 'Play'", timeout=5, label="paused"), "Pause pauses")
    browser.click(*browser.center(widget("restart")))
    check(wait_playing(browser) and seconds_shown(browser) < 5, "Restart plays from the start")
    if not muted_fallback:
        browser.click(*browser.center(widget("volume-down")))
        check(browser.wait_for(f"document.querySelector('{widget('time')}').textContent.includes('Vol 60%')", timeout=3, label="volume"), "Vol - lowers the volume")
    browser.click(*browser.center(widget("mute")))
    check(browser.wait_for(f"document.querySelector('{widget('time')}').textContent.includes('Muted')", timeout=3, label="muted"), "Mute mutes")

    print("Mouse and keyboard: switch videos")
    type_text(browser, "not a video")
    check(label(browser, "status") == "That is not a YouTube link or video ID.", "invalid link shows a message")
    check(wait_playing(browser, 5), "invalid link left the current video playing")
    type_text(browser, "https://youtu.be/jNQXAC9IVRw")
    check(browser.wait_for(f"document.querySelector('{widget('status')}').textContent.toLowerCase().includes('zoo')",
                           timeout=20, label="new video title"), "pasted link loads and plays the new video")
    check(browser.eval(f"document.querySelector('{widget('url')}').value") == "", "field clears after loading")
    type_text(browser, "xxxxxxxxxxx")
    browser.wait_for(f"!!document.querySelector('{widget('overlay')}')", timeout=20, label="error overlay")
    check(True, f"unavailable video shows: {label(browser, 'overlay').splitlines()[0]}")
    browser.click(*browser.center(widget("demo")))
    check(browser.wait_for(f"!document.querySelector('{widget('overlay')}')", timeout=20, label="recovered"), "Next demo recovers from the error")

    print("Hand: pinch the SurfaceOS Play button")
    check(wait_playing(browser), "demo video playing before the pinch")
    px, py = browser.center(widget("play"))
    hand.pinch(px / WIDTH, py / HEIGHT)
    check(browser.wait_for(f"document.querySelector('{widget('play')}').textContent === 'Play'", timeout=5, label="hand pause"),
          "hand pinch on Pause paused the video")
    if muted_fallback:
        print("  note: headless browser blocked sound, so playback used the muted fallback")


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
    server = SurfaceServer("localhost", hand_port)
    server.start()
    profile = tempfile.mkdtemp(prefix="surfaceos-yt-")
    browser_process = subprocess.Popen([executable, "--headless=new", f"--remote-debugging-port={debug_port}",
                                        f"--user-data-dir={profile}", f"--window-size={WIDTH},{HEIGHT}", "--no-first-run",
                                        "about:blank"],
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
        run(browser, Hand(server), f"http://127.0.0.1:{http_port}", f"ws://localhost:{hand_port}")
        if args.screenshot:
            args.screenshot.write_bytes(base64.b64decode(browser.send("Page.captureScreenshot", format="png")["data"]))
        browser.eval("0")
        own_errors = [e for e in browser.errors if "youtube" not in e.lower() and "googlevideo" not in e.lower()]
        if own_errors:
            print("Console errors:\n  " + "\n  ".join(own_errors))
            return 1
        print("YOUTUBE SMOKE TEST PASSED")
        return 0
    except AssertionError as error:
        print(f"FAILED: {error}")
        return 1
    finally:
        browser_process.terminate()
        http.terminate()
        time.sleep(0.5)
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
