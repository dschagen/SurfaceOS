import time
from dataclasses import dataclass

from gestures.double_pinch import DoublePinchDetector
from gestures.pinch_detector import PinchDetector, pinch_ratio
from gestures.static_gestures import NO_GESTURE, StaticGestureFilter
from vision.hand_data import HandData

PINCH_START = "PINCH_START"
PINCH_END = "PINCH_END"
DOUBLE_PINCH = "DOUBLE_PINCH"


@dataclass
class GestureState:
    hand_id: int
    is_pinching: bool
    pinch_strength: float
    pinch_ratio: float
    static_gesture: str


@dataclass
class GestureEvent:
    # PINCH_START, PINCH_END, DOUBLE_PINCH, or a static pose such as OPEN_PALM.
    type: str
    hand_id: int


class GestureDetector:
    """Converts HandData into per-hand gesture states and gesture events."""

    def __init__(self, settings: dict) -> None:
        self._pinch_settings = settings["pinch"]
        self._static_settings = settings["static_gestures"]
        self._double_pinch = DoublePinchDetector(settings["double_pinch"]["max_interval_s"],
                                                 settings["double_pinch"]["max_distance"])
        self._pinch: dict[int, PinchDetector] = {}
        self._static: dict[int, StaticGestureFilter] = {}

    def update(self, hands: list[HandData],
               now: float | None = None) -> tuple[dict[int, GestureState], list[GestureEvent]]:
        now = time.monotonic() if now is None else now
        states: dict[int, GestureState] = {}
        events: list[GestureEvent] = []

        for hand in hands:
            pinch = self._pinch.get(hand.hand_id)
            if pinch is None:
                pinch = PinchDetector(self._pinch_settings["start_ratio"],
                                      self._pinch_settings["end_ratio"])
                self._pinch[hand.hand_id] = pinch

            static = self._static.get(hand.hand_id)
            if static is None:
                static = StaticGestureFilter(self._static_settings["min_score"],
                                             self._static_settings["stable_frames"])
                self._static[hand.hand_id] = static

            was_pinching = pinch.is_pinching
            pinch_state = pinch.update(pinch_ratio(hand))
            if pinch_state.is_pinching and not was_pinching:
                events.append(GestureEvent(PINCH_START, hand.hand_id))
                if self._double_pinch.on_pinch_start(hand.hand_id, hand.index_tip, now):
                    events.append(GestureEvent(DOUBLE_PINCH, hand.hand_id))
            elif was_pinching and not pinch_state.is_pinching:
                events.append(GestureEvent(PINCH_END, hand.hand_id))

            new_pose = static.update(hand.static_gesture, hand.static_gesture_score)
            if new_pose is not None and new_pose != NO_GESTURE:
                events.append(GestureEvent(new_pose.upper(), hand.hand_id))

            states[hand.hand_id] = GestureState(
                hand_id=hand.hand_id,
                is_pinching=pinch_state.is_pinching,
                pinch_strength=pinch_state.strength,
                pinch_ratio=pinch_state.ratio,
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
                self._double_pinch.forget(hand_id)

        return states, events