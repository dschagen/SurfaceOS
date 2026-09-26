"""Plays a scripted hand-input stream over the same WebSocket as src/main.py.

Lets the shell and widget teammates test the full input contract without a camera.
Run from the project root:  python tools/fake_pointer_stream.py
"""

import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from input.events import (POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE,  # noqa: E402
                          POINTER_UP, Pointer, SurfaceInputEvent)
from server.protocol import encode, hands_debug_message  # noqa: E402
from server.server import SurfaceServer  # noqa: E402
from settings import load_settings  # noqa: E402

# The hand service no longer sends this one-hand event; this script still plays it until it is
# updated for the two-hand events.
DOUBLE_PINCH = "double_pinch"

FRAME_S = 1 / 30


class Script:
    def __init__(self, server: SurfaceServer, hand_bubbles: bool) -> None:
        self.server = server
        self.hand_bubbles = hand_bubbles
        self.x, self.y = 0.5, 0.5
        self.down = False

    def send(self, event_type: str) -> None:
        message = encode(SurfaceInputEvent(event_type, 0, self.x, self.y))
        self.server.publish(message)
        if event_type in (POINTER_DOWN, POINTER_UP, POINTER_CANCEL):
            self.down = event_type == POINTER_DOWN
        if self.hand_bubbles:
            # A cancel means the hand was lost, so the snapshot is empty until it moves again.
            hands = [] if event_type == POINTER_CANCEL else [Pointer(0, self.x, self.y, self.down, "None")]
            self.server.publish(hands_debug_message(hands, 0))
        if event_type != POINTER_MOVE:
            print(f"{event_type} x={self.x:.2f} y={self.y:.2f}")

    def move_to(self, x: float, y: float, seconds: float) -> None:
        start_x, start_y = self.x, self.y
        frames = max(1, int(seconds / FRAME_S))
        for i in range(1, frames + 1):
            t = i / frames
            self.x = start_x + (x - start_x) * t
            self.y = start_y + (y - start_y) * t
            self.send(POINTER_MOVE)
            time.sleep(FRAME_S)

    def hold(self, seconds: float) -> None:
        for _ in range(max(1, int(seconds / FRAME_S))):
            self.send(POINTER_MOVE)
            time.sleep(FRAME_S)

    def click(self) -> None:
        self.send(POINTER_DOWN)
        self.hold(0.15)
        self.send(POINTER_UP)

    def run_once(self) -> None:
        print("-- wander")
        for step in range(90):
            angle = step / 90 * 2 * math.pi
            self.x = 0.5 + 0.25 * math.cos(angle)
            self.y = 0.5 + 0.2 * math.sin(angle)
            self.send(POINTER_MOVE)
            time.sleep(FRAME_S)

        print("-- single click in the center")
        self.move_to(0.5, 0.5, 0.5)
        self.click()
        self.hold(0.8)

        print("-- double pinch, then drag out a window")
        self.move_to(0.2, 0.25, 0.6)
        self.click()
        self.hold(0.15)
        self.send(DOUBLE_PINCH)
        self.send(POINTER_DOWN)
        self.move_to(0.55, 0.65, 1.2)
        self.send(POINTER_UP)
        self.hold(1.0)

        print("-- press, then lose tracking mid-drag")
        self.move_to(0.7, 0.3, 0.5)
        self.send(POINTER_DOWN)
        self.move_to(0.8, 0.4, 0.4)
        self.send(POINTER_CANCEL)
        time.sleep(1.5)


def main() -> None:
    settings = load_settings()
    server = SurfaceServer(settings["server"]["host"], settings["server"]["port"])
    server.start()
    time.sleep(0.5)
    print("Playing fake hand input on a loop. Press Ctrl + C to stop.")
    script = Script(server, settings["debug"].get("hand_bubbles", False))
    try:
        while True:
            script.run_once()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()