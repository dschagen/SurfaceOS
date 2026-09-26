import sys
from pathlib import Path

# Tests import modules the same way src/main.py does.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from vision.hand_data import HandData  # noqa: E402

FRAME_SIZE = 640


def make_hand(hand_id: int = 0, tip: tuple[float, float] = (0.5, 0.5),
              pinch_ratio: float = 1.0, gesture: str = "None", score: float = 0.0) -> HandData:
    """Builds a HandData with a given index tip and pinch ratio, without MediaPipe."""
    normalized = [(0.5, 0.8)] * 21
    normalized[9] = (0.5, 0.6)           # middle knuckle: hand size 0.2
    normalized[8] = tip                  # index tip
    normalized[4] = (tip[0] + 0.2 * pinch_ratio, tip[1])  # thumb tip
    pixels = [(int(x * FRAME_SIZE), int(y * FRAME_SIZE)) for x, y in normalized]
    return HandData(hand_id=hand_id, handedness="Right", confidence=1.0,
                    normalized_landmarks=normalized, pixel_landmarks=pixels,
                    static_gesture=gesture, static_gesture_score=score)
