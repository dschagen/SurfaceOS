from dataclasses import dataclass

from utils.geometry import Point

Rect = tuple[float, float, float, float]  # x, y, width, height

TWO_HAND_PINCH_START = "two_hand_pinch_start"
TWO_HAND_PINCH_MOVE = "two_hand_pinch_move"
TWO_HAND_PINCH_END = "two_hand_pinch_end"
TWO_HAND_PINCH_CANCEL = "two_hand_pinch_cancel"
TWO_HAND_SINGLE_PINCH = "two_hand_single_pinch"
TWO_HAND_DOUBLE_PINCH = "two_hand_double_pinch"


@dataclass
class TwoHandEvent:
    type: str
    # Rectangle between the two pinch points, for start, move and end.
    rect: Rect | None = None
    # Midpoint between the hands, for single and double pinch.
    center: Point | None = None


def rect_between(a: Point, b: Point) -> Rect:
    x, y = min(a[0], b[0]), min(a[1], b[1])
    return (x, y, abs(a[0] - b[0]), abs(a[1] - b[1]))


def rect_center(rect: Rect) -> Point:
    return (rect[0] + rect[2] / 2, rect[1] + rect[3] / 2)


class TwoHandPinch:
    """Recognizes gestures made by pinching with both hands at once.

    While both hands pinch, the rectangle between the pinch points is reported live
    (start, move, end). On release, a pinch whose rectangle barely changed size is a
    "single" candidate. It is reported only after double_interval_s passes without a
    second one; a second such pinch within that time is reported as a double pinch
    instead. Losing a hand mid-gesture cancels it and reports nothing else.
    """

    def __init__(self, single_max_spread: float, double_interval_s: float) -> None:
        self._single_max_spread = single_max_spread
        self._double_interval_s = double_interval_s
        self.active = False
        self._start_rect: Rect | None = None
        self._rect: Rect | None = None
        self._max_size_change = 0.0
        self._pending_single_at: float | None = None
        self._pending_center: Point | None = None
        self._is_second_pinch = False

    def update(self, pinch_points: list[Point] | None, hands_visible: int, now: float) -> list[TwoHandEvent]:
        """pinch_points holds both pinch points while both hands pinch, otherwise None."""
        events: list[TwoHandEvent] = []

        if pinch_points is not None:
            rect = rect_between(pinch_points[0], pinch_points[1])
            if not self.active:
                self.active = True
                self._start_rect = rect
                self._max_size_change = 0.0
                # A new two-hand pinch while a single is still pending makes this the second pinch.
                self._is_second_pinch = self._pending_single_at is not None
                self._pending_single_at = None
                events.append(TwoHandEvent(TWO_HAND_PINCH_START, rect=rect))
            else:
                size_change = max(abs(rect[2] - self._start_rect[2]), abs(rect[3] - self._start_rect[3]))
                self._max_size_change = max(self._max_size_change, size_change)
                events.append(TwoHandEvent(TWO_HAND_PINCH_MOVE, rect=rect))
            self._rect = rect

        elif self.active:
            self.active = False
            if hands_visible < 2:
                events.append(TwoHandEvent(TWO_HAND_PINCH_CANCEL))
                self._is_second_pinch = False
            else:
                events.append(TwoHandEvent(TWO_HAND_PINCH_END, rect=self._rect))
                if self._max_size_change < self._single_max_spread:
                    if self._is_second_pinch:
                        events.append(TwoHandEvent(TWO_HAND_DOUBLE_PINCH, center=rect_center(self._rect)))
                    else:
                        self._pending_single_at = now + self._double_interval_s
                        self._pending_center = rect_center(self._rect)
                self._is_second_pinch = False

        if self._pending_single_at is not None and not self.active and now >= self._pending_single_at:
            events.append(TwoHandEvent(TWO_HAND_SINGLE_PINCH, center=self._pending_center))
            self._pending_single_at = None

        return events