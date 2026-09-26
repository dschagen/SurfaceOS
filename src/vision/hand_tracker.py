import time

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

import config
from utils.geometry import distance
from vision.hand_data import INDEX_TIP, MIDDLE_KNUCKLE, THUMB_TIP, WRIST, HandData


class HandTracker:
    """Reads camera frames and returns raw hand data. Does not decide what gestures mean."""

    def __init__(self) -> None:
        self.camera = cv2.VideoCapture(config.CAMERA_INDEX)
        if not self.camera.isOpened():
            raise RuntimeError(f"Could not open camera {config.CAMERA_INDEX}")

        options = vision.GestureRecognizerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(config.MODEL_PATH)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=config.MAX_HANDS,
        )
        self.recognizer = vision.GestureRecognizer.create_from_options(options)
        self.last_timestamp_ms = -1

    def read(self):
        """Returns (frame, hands). frame is None if the camera stopped delivering images."""
        success, frame = self.camera.read()
        if not success:
            return None, []

        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # VIDEO mode requires strictly increasing timestamps.
        timestamp_ms = max(int(time.monotonic() * 1000), self.last_timestamp_ms + 1)
        self.last_timestamp_ms = timestamp_ms
        result = self.recognizer.recognize_for_video(image, timestamp_ms)

        hands = []
        for i, landmarks in enumerate(result.hand_landmarks):
            points = [(int(lm.x * width), int(lm.y * height)) for lm in landmarks]

            # Dividing by hand size makes the pinch work at any distance from the camera.
            hand_size = distance(points[WRIST], points[MIDDLE_KNUCKLE])
            pinch_ratio = distance(points[THUMB_TIP], points[INDEX_TIP]) / max(hand_size, 1.0)

            tip_x = landmarks[INDEX_TIP].x
            if config.MIRROR_X:
                tip_x = 1.0 - tip_x

            gesture = "None"
            if i < len(result.gestures) and result.gestures[i]:
                gesture = result.gestures[i][0].category_name

            handedness = "Unknown"
            if i < len(result.handedness) and result.handedness[i]:
                handedness = result.handedness[i][0].category_name

            hands.append(HandData(
                pixel_points=points,
                index_tip=(tip_x, landmarks[INDEX_TIP].y),
                pinch_ratio=pinch_ratio,
                gesture=gesture,
                handedness=handedness,
            ))

        return frame, hands

    def close(self) -> None:
        self.recognizer.close()
        self.camera.release()
