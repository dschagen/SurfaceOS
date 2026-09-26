import time
from dataclasses import dataclass

from gestures.hand_pose import is_pointing
from gestures.pinch_detector import PinchDetector, pinch_ratio
from gestures.static_gestures import StaticGestureFilter
from vision.hand_data import HandData

PINCH_START = "PINCH_START"
PINCH_END = "PINCH_END"
THUMBS_DOWN = "THUMBS_DOWN"

# MediaPipe's label for the thumbs-down pose.
THUMB_DOWN_LABEL = "Thumb_Down"


@dataclass
class GestureState:
    hand_id: int
    is_pinching: bool
    pinch_strength: float
    pinch_ratio: float
    # Index finger straight, other fingers curled, and not pinching.
    is_pointing: bool
    static_gesture: str


@dataclass
class GestureEvent:
    # PINCH_START, PINCH_END, or THUMBS_DOWN.
    type: str
    hand_id: int


class GestureDetector:
    """Converts HandData into per-hand gesture states and one-hand gesture events."""

    def __init__(self, settings: dict) -> None:
        self._pinch_settings = settings["pinch"]
        self._static_settings = settings["static_gestures"]
        self._thumbs_down_hold_s = settings["thumbs_down"]["hold_s"]
        self._pinch: dict[int, PinchDetector] = {}
        self._static: dict[int, StaticGestureFilter] = {}
        # When each hand's stable pose became thumbs down, and whether it already fired.
        self._thumbs_down_since: dict[int, float] = {}
        self._thumbs_down_fired: set[int] = set()

    def update(self, hands: list[HandData],
               now: float | None = None) -> tuple[dict[int, GestureState], list[GestureEvent]]:
        now = time.monotonic() if now is None else now
        states: dict[int, GestureState] = {}
        events: list[GestureEvent] = []

        for hand in hands:
            hand_id = hand.hand_id
            pinch = self._pinch.get(hand_id)
            if pinch is None:
                pinch = PinchDetector(self._pinch_settings["start_ratio"],
                                      self._pinch_settings["end_ratio"])
                self._pinch[hand_id] = pinch

            static = self._static.get(hand_id)
            if static is None:
                static = StaticGestureFilter(self._static_settings["min_score"],
                                             self._static_settings["stable_frames"])
                self._static[hand_id] = static

            was_pinching = pinch.is_pinching
            pinch_state = pinch.update(pinch_ratio(hand))
            if pinch_state.is_pinching and not was_pinching:
                events.append(GestureEvent(PINCH_START, hand_id))
            elif was_pinching and not pinch_state.is_pinching:
                events.append(GestureEvent(PINCH_END, hand_id))

            static.update(hand.static_gesture, hand.static_gesture_score)
            if self._update_thumbs_down(hand_id, static.stable, now):
                events.append(GestureEvent(THUMBS_DOWN, hand_id))

            states[hand_id] = GestureState(
                hand_id=hand_id,
                is_pinching=pinch_state.is_pinching,
                pinch_strength=pinch_state.strength,
                pinch_ratio=pinch_state.ratio,
                is_pointing=is_pointing(hand) and not pinch_state.is_pinching,
                static_gesture=static.stable,
            )

        # A hand that leaves the camera must not stay pinched.
        visible_ids = {hand.hand_id for hand in hands}
        for hand_id in list(self._pinch):
            if hand_id not in visible_ids:
                if self._pinch[hand_id].is_pinching:
                    events.append(GestureEvent(PINCH_END, hand_id))
                del self._pinch[hand_id]
                self._static.pop(hand_id, None)
                self._thumbs_down_since.pop(hand_id, None)
                self._thumbs_down_fired.discard(hand_id)

        return states, events

    def _update_thumbs_down(self, hand_id: int, stable_pose: str, now: float) -> bool:
        """True once per hold: after the pose has been thumbs down for hold_s.

        Fires again only after the hand leaves the pose and holds it again.
        """
        if stable_pose != THUMB_DOWN_LABEL:
            self._thumbs_down_since.pop(hand_id, None)
            self._thumbs_down_fired.discard(hand_id)
            return False
        since = self._thumbs_down_since.setdefault(hand_id, now)
        if hand_id not in self._thumbs_down_fired and now - since >= self._thumbs_down_hold_s:
            self._thumbs_down_fired.add(hand_id)
            return True
        return False