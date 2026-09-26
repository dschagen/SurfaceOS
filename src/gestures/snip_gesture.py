import time

import config
from gestures.gesture_detector import TrackedHand

Rect = tuple[float, float, float, float]


class SnipGesture:
    """Two-hand snip: both hands pinch to start, spread to size, release one to capture.

    Losing sight of a hand cancels the snip instead of capturing it.
    """

    def __init__(self) -> None:
        self.active = False
        self.rect: Rect | None = None
        self.pending_rect: Rect | None = None
        self.capture_at: float | None = None

    @property
    def capturing(self) -> bool:
        return self.capture_at is not None

    def update(self, hands: list[TrackedHand]) -> Rect | None:
        """Returns the rectangle to capture on the frame the capture should happen, else None."""
        now = time.monotonic()
        both_pinching = len(hands) == 2 and all(hand.pinch for hand in hands)

        if both_pinching and not self.capturing:
            self.active = True
            xs = [hand.x for hand in hands]
            ys = [hand.y for hand in hands]
            self.rect = (min(xs), min(ys), max(xs), max(ys))
        elif self.active:
            self.active = False
            width = self.rect[2] - self.rect[0]
            height = self.rect[3] - self.rect[1]
            big_enough = width >= config.MIN_SNIP_SIZE and height >= config.MIN_SNIP_SIZE
            if len(hands) == 2 and big_enough:
                self.pending_rect = self.rect
                self.capture_at = now + config.CAPTURE_DELAY_S
            else:
                print("Snip cancelled")

        if self.capturing and now >= self.capture_at:
            self.capture_at = None
            return self.pending_rect
        return None

    def rect_dict(self) -> dict | None:
        if not self.active:
            return None
        return dict(zip(("x1", "y1", "x2", "y2"), self.rect))
