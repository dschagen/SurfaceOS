from dataclasses import dataclass

from utils.geometry import clamp, distance
from vision.hand_data import INDEX_TIP, MIDDLE_KNUCKLE, THUMB_TIP, WRIST, HandData

# Approximate pinch ratio of a relaxed open hand; used only to scale pinch_strength.
OPEN_HAND_RATIO = 1.0


def pinch_ratio(hand: HandData) -> float:
    """Thumb-to-index distance divided by hand size, so it works at any distance from the camera.

    Pixel coordinates are used because normalized x and y have different scales on non-square frames.
    """
    points = hand.pixel_landmarks
    hand_size = distance(points[WRIST], points[MIDDLE_KNUCKLE])
    return distance(points[THUMB_TIP], points[INDEX_TIP]) / max(hand_size, 1.0)


@dataclass
class PinchState:
    is_pinching: bool
    ratio: float
    strength: float


class PinchDetector:
    """Pinch detection for one hand with hysteresis and a release grace period.

    Two thresholds keep the state from flickering when the ratio hovers near one boundary.
    The pinch ends only after the fingers have stayed apart for release_grace_s, so a brief
    tracking dropout while the thumb is hidden behind the index finger does not break a drag.
    """

    def __init__(self, start_ratio: float, end_ratio: float, release_grace_s: float = 0.0) -> None:
        if start_ratio >= end_ratio:
            raise ValueError("start_ratio must be smaller than end_ratio")
        self._start_ratio = start_ratio
        self._end_ratio = end_ratio
        self._release_grace_s = release_grace_s
        self._apart_since: float | None = None
        self.is_pinching = False

    def update(self, ratio: float, now: float | None = None) -> PinchState:
        """now is required for the grace period; without it a release takes effect immediately."""
        if not self.is_pinching:
            if ratio < self._start_ratio:
                self.is_pinching = True
                self._apart_since = None
        elif ratio > self._end_ratio:
            if now is None or self._release_grace_s <= 0:
                self.is_pinching = False
            else:
                if self._apart_since is None:
                    self._apart_since = now
                if now - self._apart_since >= self._release_grace_s:
                    self.is_pinching = False
                    self._apart_since = None
        else:
            # Fingers came back together within the grace period: the pinch never ended.
            self._apart_since = None

        strength = clamp((OPEN_HAND_RATIO - ratio) / (OPEN_HAND_RATIO - self._start_ratio))
        return PinchState(is_pinching=self.is_pinching, ratio=ratio, strength=strength)
