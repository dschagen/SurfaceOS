from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

from utils.timing import monotonic_ms
from vision.hand_data import HandData
from vision.hand_identity import HandIdentifier


class HandTracker:
    """Runs MediaPipe on camera frames and returns HandData. Does not decide what gestures mean."""

    def __init__(self, model_path: Path, max_hands: int, identity_match_distance: float) -> None:
        options = vision.GestureRecognizerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=max_hands,
        )
        self._recognizer = vision.GestureRecognizer.create_from_options(options)
        self._identifier = HandIdentifier(identity_match_distance)
        self._last_timestamp_ms = -1

    def process(self, frame) -> list[HandData]:
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # VIDEO mode requires strictly increasing timestamps.
        timestamp_ms = max(monotonic_ms(), self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms
        result = self._recognizer.recognize_for_video(image, timestamp_ms)

        normalized_sets = []
        for landmarks in result.hand_landmarks:
            normalized_sets.append([(lm.x, lm.y) for lm in landmarks])

        ids = self._identifier.assign([points[0] for points in normalized_sets])

        hands = []
        for i, (hand_id, normalized) in enumerate(zip(ids, normalized_sets)):
            handedness, confidence = "Unknown", 0.0
            if i < len(result.handedness) and result.handedness[i]:
                category = result.handedness[i][0]
                handedness, confidence = category.category_name, category.score

            gesture, gesture_score = "None", 0.0
            if i < len(result.gestures) and result.gestures[i]:
                category = result.gestures[i][0]
                gesture, gesture_score = category.category_name, category.score

            hands.append(HandData(
                hand_id=hand_id,
                handedness=handedness,
                confidence=confidence,
                normalized_landmarks=normalized,
                pixel_landmarks=[(int(x * width), int(y * height)) for x, y in normalized],
                static_gesture=gesture,
                static_gesture_score=gesture_score,
            ))
        return hands

    def close(self) -> None:
        self._recognizer.close()