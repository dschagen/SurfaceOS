import math
import time

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

MODEL_PATH = "models/gesture_recognizer.task"
CAMERA_INDEX = 0

# Pinch ratio = thumb-to-index distance divided by hand size.
# Two thresholds (hysteresis) keep the pinch from flickering at the boundary.
# These are starting guesses; tune them using the ratio shown on screen.
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


def distance(a: tuple[int, int], b: tuple[int, int]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def main() -> None:
    camera = cv2.VideoCapture(CAMERA_INDEX)
    if not camera.isOpened():
        print(f"ERROR: Could not open camera {CAMERA_INDEX}")
        raise SystemExit(1)

    options = vision.GestureRecognizerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
    )

    is_pinching = False
    last_timestamp_ms = -1

    print("Hand test running. Press Q in the video window to quit.")

    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        while True:
            success, frame = camera.read()
            if not success:
                print("ERROR: Could not read frame")
                break

            height, width = frame.shape[:2]

            # MediaPipe expects RGB; OpenCV captures BGR.
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # VIDEO mode requires strictly increasing timestamps.
            timestamp_ms = max(int(time.monotonic() * 1000), last_timestamp_ms + 1)
            last_timestamp_ms = timestamp_ms

            result = recognizer.recognize_for_video(mp_image, timestamp_ms)

            if result.hand_landmarks:
                landmarks = result.hand_landmarks[0]

                # Convert normalized 0-1 coordinates to pixels.
                points = [(int(lm.x * width), int(lm.y * height)) for lm in landmarks]

                for start, end in HAND_CONNECTIONS:
                    cv2.line(frame, points[start], points[end], (200, 200, 200), 2)
                for point in points:
                    cv2.circle(frame, point, 4, (255, 255, 255), -1)

                # Dividing by hand size makes pinch work at any distance from the camera.
                hand_size = distance(points[WRIST], points[MIDDLE_KNUCKLE])
                pinch_ratio = distance(points[THUMB_TIP], points[INDEX_TIP]) / max(hand_size, 1.0)

                if not is_pinching and pinch_ratio < PINCH_START_RATIO:
                    is_pinching = True
                    print("PINCH_START")
                elif is_pinching and pinch_ratio > PINCH_END_RATIO:
                    is_pinching = False
                    print("PINCH_END")

                tip_color = (0, 255, 0) if is_pinching else (0, 0, 255)
                cv2.circle(frame, points[INDEX_TIP], 12, tip_color, -1)

                gesture_name = "None"
                if result.gestures and result.gestures[0]:
                    gesture_name = result.gestures[0][0].category_name

                tip_x = landmarks[INDEX_TIP].x
                tip_y = landmarks[INDEX_TIP].y
                lines = [
                    f"Index tip: x={tip_x:.2f} y={tip_y:.2f}",
                    f"Pinch ratio: {pinch_ratio:.2f}",
                    f"Pinching: {is_pinching}",
                    f"Gesture: {gesture_name}",
                ]
            else:
                is_pinching = False
                lines = ["No hand detected"]

            for i, text in enumerate(lines):
                cv2.putText(frame, text, (10, 30 + i * 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            cv2.imshow("SurfaceOS Hand Test", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    camera.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
