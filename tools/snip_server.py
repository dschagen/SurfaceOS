import asyncio
import json
import math
import threading
import time
from pathlib import Path

import cv2
import mediapipe as mp
import mss
import mss.tools
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = str(PROJECT_ROOT / "models" / "gesture_recognizer.task")
SNIP_DIR = PROJECT_ROOT / "snips"

CAMERA_INDEX = 0
SERVER_HOST = "localhost"
SERVER_PORT = 8765
SEND_RATE_HZ = 60

MIRROR_X = True
SMOOTHING = 0.5
PINCH_START_RATIO = 0.25
PINCH_END_RATIO = 0.35

# "screen" saves a screenshot of that region of the monitor.
# "camera" saves that region of the webcam image (useful for snipping paper on the table).
SNIP_SOURCE = "screen"

# 1 = primary monitor. Set to 2 when the projector is the second display.
SNIP_MONITOR = 1

# Snips smaller than this fraction of the screen are treated as accidental and cancelled.
MIN_SNIP_SIZE = 0.03

# Delay before capturing so the browser has time to hide the snip overlay.
CAPTURE_DELAY_S = 0.15

# Turn off if the camera preview window gets in the way of screen snips.
SHOW_PREVIEW = True

WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
MIDDLE_KNUCKLE = 9
MAX_HANDS = 2

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

state_lock = threading.Lock()
latest_state = {
    "hands": [],
    "snip": None,
    "capturing": False,
    "snip_count": 0,
    "last_snip": "",
}


def distance(a: tuple[int, int], b: tuple[int, int]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


async def handle_browser(websocket) -> None:
    print("Browser connected")
    try:
        while True:
            with state_lock:
                message = json.dumps(latest_state)
            await websocket.send(message)
            await asyncio.sleep(1 / SEND_RATE_HZ)
    except ConnectionClosed:
        print("Browser disconnected")


async def run_server() -> None:
    async with serve(handle_browser, SERVER_HOST, SERVER_PORT) as server:
        print(f"WebSocket server listening on ws://{SERVER_HOST}:{SERVER_PORT}")
        await server.serve_forever()


def start_server_thread() -> None:
    thread = threading.Thread(target=lambda: asyncio.run(run_server()), daemon=True)
    thread.start()


def snip_filename() -> Path:
    return SNIP_DIR / f"snip_{time.strftime('%Y%m%d_%H%M%S')}.png"


def capture_screen(rect: tuple[float, float, float, float]) -> Path:
    x1, y1, x2, y2 = rect
    with mss.mss() as screen:
        monitor = screen.monitors[SNIP_MONITOR]
        region = {
            "left": monitor["left"] + int(x1 * monitor["width"]),
            "top": monitor["top"] + int(y1 * monitor["height"]),
            "width": max(1, int((x2 - x1) * monitor["width"])),
            "height": max(1, int((y2 - y1) * monitor["height"])),
        }
        shot = screen.grab(region)
        path = snip_filename()
        mss.tools.to_png(shot.rgb, shot.size, output=str(path))
    return path


def capture_camera(frame, rect: tuple[float, float, float, float]) -> Path:
    x1, y1, x2, y2 = rect
    # The rectangle is in mirrored (screen) space; convert back to raw camera columns.
    if MIRROR_X:
        x1, x2 = 1.0 - x2, 1.0 - x1
    height, width = frame.shape[:2]
    crop = frame[int(y1 * height):int(y2 * height), int(x1 * width):int(x2 * width)]
    path = snip_filename()
    cv2.imwrite(str(path), crop)
    return path


def main() -> None:
    camera = cv2.VideoCapture(CAMERA_INDEX)
    if not camera.isOpened():
        print(f"ERROR: Could not open camera {CAMERA_INDEX}")
        raise SystemExit(1)

    SNIP_DIR.mkdir(exist_ok=True)
    start_server_thread()

    options = vision.GestureRecognizerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=MAX_HANDS,
    )

    pinch_states = [False] * MAX_HANDS
    smooth_points: list[tuple[float, float] | None] = [None] * MAX_HANDS
    previous_hand_count = 0

    snip_active = False
    snip_rect: tuple[float, float, float, float] | None = None
    pending_rect: tuple[float, float, float, float] | None = None
    capture_at: float | None = None
    snip_count = 0
    last_snip = ""
    last_timestamp_ms = -1

    print("Snip tool running. Pinch with both hands, spread them apart, then release.")
    print(f"Snips are saved to {SNIP_DIR}")
    print("Press Q in the video window to quit.")

    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        while True:
            success, frame = camera.read()
            if not success:
                print("ERROR: Could not read frame")
                break

            clean_frame = frame.copy()
            height, width = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            timestamp_ms = max(int(time.monotonic() * 1000), last_timestamp_ms + 1)
            last_timestamp_ms = timestamp_ms
            result = recognizer.recognize_for_video(mp_image, timestamp_ms)

            detected = []
            for landmarks in result.hand_landmarks:
                points = [(int(lm.x * width), int(lm.y * height)) for lm in landmarks]
                hand_size = distance(points[WRIST], points[MIDDLE_KNUCKLE])
                ratio = distance(points[THUMB_TIP], points[INDEX_TIP]) / max(hand_size, 1.0)
                tip_x = landmarks[INDEX_TIP].x
                if MIRROR_X:
                    tip_x = 1.0 - tip_x
                detected.append({"points": points, "ratio": ratio,
                                 "x": tip_x, "y": landmarks[INDEX_TIP].y})

            # Handedness labels can flicker, so hands are identified by screen position instead:
            # slot 0 is always the leftmost hand.
            detected.sort(key=lambda hand: hand["x"])

            # When a hand appears or disappears the slots shift, so per-slot state is reset.
            if len(detected) != previous_hand_count:
                pinch_states = [False] * MAX_HANDS
                smooth_points = [None] * MAX_HANDS
                previous_hand_count = len(detected)

            hands_out = []
            for slot, hand in enumerate(detected):
                if not pinch_states[slot] and hand["ratio"] < PINCH_START_RATIO:
                    pinch_states[slot] = True
                elif pinch_states[slot] and hand["ratio"] > PINCH_END_RATIO:
                    pinch_states[slot] = False

                previous = smooth_points[slot]
                if previous is None:
                    smooth = (hand["x"], hand["y"])
                else:
                    smooth = (SMOOTHING * previous[0] + (1 - SMOOTHING) * hand["x"],
                              SMOOTHING * previous[1] + (1 - SMOOTHING) * hand["y"])
                smooth_points[slot] = smooth

                hands_out.append({"x": round(smooth[0], 4), "y": round(smooth[1], 4),
                                  "pinch": pinch_states[slot]})

                points = hand["points"]
                for start, end in HAND_CONNECTIONS:
                    cv2.line(frame, points[start], points[end], (200, 200, 200), 2)
                tip_color = (0, 255, 0) if pinch_states[slot] else (0, 0, 255)
                cv2.circle(frame, points[INDEX_TIP], 12, tip_color, -1)

            both_pinching = len(hands_out) == 2 and all(h["pinch"] for h in hands_out)

            if both_pinching and capture_at is None:
                snip_active = True
                xs = [h["x"] for h in hands_out]
                ys = [h["y"] for h in hands_out]
                snip_rect = (min(xs), min(ys), max(xs), max(ys))
            elif snip_active:
                snip_active = False
                snip_width = snip_rect[2] - snip_rect[0]
                snip_height = snip_rect[3] - snip_rect[1]
                # Releasing a pinch captures; losing sight of a hand cancels.
                if len(hands_out) == 2 and snip_width >= MIN_SNIP_SIZE and snip_height >= MIN_SNIP_SIZE:
                    pending_rect = snip_rect
                    capture_at = time.monotonic() + CAPTURE_DELAY_S
                else:
                    print("Snip cancelled")

            if capture_at is not None and time.monotonic() >= capture_at:
                if SNIP_SOURCE == "camera":
                    path = capture_camera(clean_frame, pending_rect)
                else:
                    path = capture_screen(pending_rect)
                snip_count += 1
                last_snip = path.name
                capture_at = None
                print(f"Saved {path}")

            with state_lock:
                latest_state.update(
                    hands=hands_out,
                    snip=(dict(zip(("x1", "y1", "x2", "y2"), snip_rect)) if snip_active else None),
                    capturing=capture_at is not None,
                    snip_count=snip_count,
                    last_snip=last_snip,
                )

            status = f"hands={len(hands_out)} snipping={snip_active}"
            cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 255, 255), 2)
            if SHOW_PREVIEW:
                cv2.imshow("SurfaceOS Tracker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    camera.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
