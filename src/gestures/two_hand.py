from dataclasses import dataclass

from utils.geometry import Point, clamp

Rect = tuple[float, float, float, float]  # x, y, width, height

TWO_HAND_PINCH_START = "two_hand_pinch_start"
TWO_HAND_PINCH_MOVE = "two_hand_pinch_move"
TWO_HAND_PINCH_END = "two_hand_pinch_end"
TWO_HAND_PINCH_CANCEL = "two_hand_pinch_cancel"
TWO_HAND_HOLD = "two_hand_hold"


@dataclass
class TwoHandEvent:
    type: str
    # Rectangle between the two pinch points, for start, move and end.
    rect: Rect | None = None
    # Midpoint between the hands, for hold.
    center: Point | None = None


def rect_between(a: Point, b: Point) -> Rect:
    x, y = min(a[0], b[0]), min(a[1], b[1])
    return (x, y, abs(a[0] - b[0]), abs(a[1] - b[1]))


def rect_center(rect: Rect) -> Point:
    return (rect[0] + rect[2] / 2, rect[1] + rect[3] / 2)


class TwoHandPinch:
    """Recognizes gestures made by pinching with both hands at once.

    While both hands pinch, the rectangle between the pinch points is reported live
    (start, move, end) so the shell can draw a window. If the rectangle stays nearly the
    same size for hold_s, one two_hand_hold is reported; spreading the hands first means
    drawing instead. Losing a hand mid-gesture cancels it.
    """

    def __init__(self, hold_s: float, hold_max_spread: float) -> None:
        self._hold_s = hold_s
        self._hold_max_spread = hold_max_spread
        self.active = False
        self._start_rect: Rect | None = None
        self._rect: Rect | None = None
        self._max_size_change = 0.0
        self._started_at = 0.0
        self._now = 0.0
        self._hold_fired = False

    @property
    def hold_progress(self) -> float:
        """0 to 1 while a hold is building up; 0 when idle, spreading, or already fired."""
        if not self.active or self._hold_fired or self._max_size_change >= self._hold_max_spread:
            return 0.0
        return clamp((self._now - self._started_at) / self._hold_s)

    def update(self, pinch_points: list[Point] | None, hands_visible: int, now: float) -> list[TwoHandEvent]:
        """pinch_points holds both pinch points while both hands pinch, otherwise None."""
        self._now = now
        events: list[TwoHandEvent] = []

        if pinch_points is not None:
            rect = rect_between(pinch_points[0], pinch_points[1])
            if not self.active:
                self.active = True
                self._start_rect = rect
                self._max_size_change = 0.0
                self._started_at = now
                self._hold_fired = False
                events.append(TwoHandEvent(TWO_HAND_PINCH_START, rect=rect))
            else:
                size_change = max(abs(rect[2] - self._start_rect[2]), abs(rect[3] - self._start_rect[3]))
                self._max_size_change = max(self._max_size_change, size_change)
                events.append(TwoHandEvent(TWO_HAND_PINCH_MOVE, rect=rect))
            self._rect = rect
            if (not self._hold_fired and self._max_size_change < self._hold_max_spread
                    and now - self._started_at >= self._hold_s):
                self._hold_fired = True
                events.append(TwoHandEvent(TWO_HAND_HOLD, center=rect_center(rect)))

        elif self.active:
            self.active = False
            if hands_visible < 2:
                events.append(TwoHandEvent(TWO_HAND_PINCH_CANCEL))
            else:
                events.append(TwoHandEvent(TWO_HAND_PINCH_END, rect=self._rect))

        return events
