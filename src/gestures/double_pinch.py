from utils.geometry import Point, distance


class DoublePinchDetector:
    """Detects two pinch starts from the same hand that are close together in time and place.

    Measured from the first pinch start to the second. After a detection the sequence resets,
    so a third quick pinch starts a new sequence instead of firing again.
    """

    def __init__(self, max_interval_s: float, max_distance: float) -> None:
        self._max_interval_s = max_interval_s
        self._max_distance = max_distance
        self._last_start: dict[int, tuple[float, Point]] = {}

    def on_pinch_start(self, hand_id: int, position: Point, now: float) -> bool:
        previous = self._last_start.get(hand_id)
        if previous is not None:
            previous_time, previous_position = previous
            quick = now - previous_time <= self._max_interval_s
            close = distance(position, previous_position) <= self._max_distance
            if quick and close:
                del self._last_start[hand_id]
                return True
        self._last_start[hand_id] = (now, position)
        return False

    def forget(self, hand_id: int) -> None:
        self._last_start.pop(hand_id, None)