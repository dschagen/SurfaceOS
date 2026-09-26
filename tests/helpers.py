import sys
from pathlib import Path

# Tests import modules the same way src/main.py does.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from vision.hand_data import HandData  # noqa: E402

FRAME_SIZE = 640


def make_hand(hand_id: int = 0, tip: tuple[float, float] = (0.5, 0.5),
              pinch_ratio: float = 1.0, gesture: str = "None", score: float = 0.0,
              pointing: bool = False) -> HandData:
    """Builds a HandData with a given index tip and pinch ratio, without MediaPipe.

    With pointing=True the index finger is straight and the other fingers are curled.
    """
    if pointing:
        normalized = _pointing_landmarks(tip, pinch_ratio)
    else:
        normalized = [(0.5, 0.8)] * 21
        normalized[9] = (0.5, 0.6)           # middle knuckle: hand size 0.2
        normalized[8] = tip                  # index tip
        normalized[4] = (tip[0] + 0.2 * pinch_ratio, tip[1])  # thumb tip
    pixels = [(int(x * FRAME_SIZE), int(y * FRAME_SIZE)) for x, y in normalized]
    return HandData(hand_id=hand_id, handedness="Right", confidence=1.0,
                    normalized_landmarks=normalized, pixel_landmarks=pixels,
                    static_gesture=gesture, static_gesture_score=score)


def _pointing_landmarks(tip: tuple[float, float], pinch_ratio: float) -> list[tuple[float, float]]:
    x, y = tip

    def at(dx, dy):
        return (x + dx, y + dy)

    points = [at(0.0, 0.30)] * 21                      # wrist and anything unset
    points[5], points[6], points[7], points[8] = at(0, 0.15), at(0, 0.10), at(0, 0.05), tip
    points[9] = at(0.03, 0.15)                         # middle knuckle: hand size about 0.15
    for pip, finger_tip, dx in ((10, 12, 0.03), (14, 16, 0.05), (18, 20, 0.07)):
        points[pip] = at(dx, 0.12)                     # curled: tip closer to the wrist than the joint
        points[finger_tip] = at(dx, 0.22)
    points[4] = at(0.15 * pinch_ratio, 0.0)            # thumb tip
    return points
