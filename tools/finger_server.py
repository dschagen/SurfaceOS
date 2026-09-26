import asyncio
import json
import math
import threading
import time
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

MODEL_PATH = str(Path(__file__).resolve().parent.parent / "models" / "gesture_recognizer.task")
CAMERA_INDEX = 0
SERVER_HOST = "localhost"
SERVER_PORT = 8765
SEND_RATE_HZ = 60

# A laptop webcam faces you, so moving your hand right moves it left in the image.
# Mirroring makes the cursor follow your hand naturally during laptop testing.
# Set this to False once the camera looks down at the projected table.
MIRROR_X = True

# 0 = no smoothing (jittery), closer to 1 = smoother but laggier.
SMOOTHING = 0.5

PINCH_START_RATIO = 0.25
PINCH_END_RATIO = 0.35

WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
MIDDLE_KNUCKLE = 9

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

# Shared between the camera loop (main thread) and the WebSocket server (background thread).
state_lock = threading.Lock()
latest_state = {"hand": False, "x": 0.5, "y": 0.5, "pinch": False}


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
    # Daemon thread exits automatically when the camera loop ends.
    thread = threading.Thread(target=lambda: asyncio.run(run_server()), daemon=True)
    thread.start()


def main() -> None:
    camera = cv2.VideoCapture(CAMERA_INDEX)
    if not camera.isOpened():
        print(f"ERROR: Could not open camera {CAMERA_INDEX}")
        raise SystemExit(1)

    start_server_thread()

    options = vision.GestureRecognizerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
    )

    is_pinching = False
    smooth_x, smooth_y = 0.5, 0.5
    last_timestamp_ms = -1

    print("Tracker running. Press Q in the video window to quit.")

    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        while True:
            success, frame = camera.read()
            if not success:
                print("ERROR: Could not read frame")
                break

            height, width = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            timestamp_ms = max(int(time.monotonic() * 1000), last_timestamp_ms + 1)
            last_timestamp_ms = timestamp_ms

            result = recognizer.recognize_for_video(mp_image, timestamp_ms)

            if result.hand_landmarks:
                landmarks = result.hand_landmarks[0]
                points = [(int(lm.x * width), int(lm.y * height)) for lm in landmarks]

                for start, end in HAND_CONNECTIONS:
                    cv2.line(frame, points[start], points[end], (200, 200, 200), 2)

                hand_size = distance(points[WRIST], points[MIDDLE_KNUCKLE])
                pinch_ratio = distance(points[THUMB_TIP], points[INDEX_TIP]) / max(hand_size, 1.0)

                if not is_pinching and pinch_ratio < PINCH_START_RATIO:
                    is_pinching = True
                elif is_pinching and pinch_ratio > PINCH_END_RATIO:
                    is_pinching = False

                raw_x = landmarks[INDEX_TIP].x
                raw_y = landmarks[INDEX_TIP].y
                if MIRROR_X:
                    raw_x = 1.0 - raw_x

                smooth_x = SMOOTHING * smooth_x + (1 - SMOOTHING) * raw_x
                smooth_y = SMOOTHING * smooth_y + (1 - SMOOTHING) * raw_y

                with state_lock:
                    latest_state.update(hand=True, x=round(smooth_x, 4),
                                        y=round(smooth_y, 4), pinch=is_pinching)

                tip_color = (0, 255, 0) if is_pinching else (0, 0, 255)
                cv2.circle(frame, points[INDEX_TIP], 12, tip_color, -1)
                status = f"x={smooth_x:.2f} y={smooth_y:.2f} pinch={is_pinching} ratio={pinch_ratio:.2f}"
            else:
                is_pinching = False
                with state_lock:
                    latest_state.update(hand=False, pinch=False)
                status = "No hand detected"

            cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (0, 255, 255), 2)
            cv2.imshow("SurfaceOS Tracker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    camera.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
