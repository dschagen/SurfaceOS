import time
from dataclasses import dataclass

from gestures.hand_pose import is_pointing
from gestures.pinch_detector import PinchDetector, pinch_ratio
from gestures.static_gestures import StaticGestureFilter
from vision.hand_data import HandData

PINCH_START = "PINCH_START"
PINCH_END = "PINCH_END"
THUMBS_DOWN = "THUMBS_DOWN"
THUMBS_UP = "THUMBS_UP"
PEACE_SIGN = "PEACE_SIGN"

# MediaPipe labels of poses that fire an event once held for hold_s.
HELD_POSES = {"Thumb_Down": THUMBS_DOWN, "Thumb_Up": THUMBS_UP, "Victory": PEACE_SIGN}


@dataclass
class GestureState:
    hand_id: int
    is_pinching: bool
    pinch_strength: float
    pinch_ratio: float
    # Index finger straight, other fingers curled, and not pinching.
    is_pointing: bool
    static_gesture: str
    # 0 to 1 while a held pose (thumbs down, thumbs up, peace sign) is building up to its event.
    pose_hold_progress: float = 0.0


@dataclass
class GestureEvent:
    # PINCH_START, PINCH_END, THUMBS_DOWN, THUMBS_UP, or PEACE_SIGN.
    type: str
    hand_id: int


class GestureDetector:
    """Converts HandData into per-hand gesture states and one-hand gesture events."""

    def __init__(self, settings: dict) -> None:
        self._pinch_settings = settings["pinch"]
        self._static_settings = settings["static_gestures"]
        self._hold_s = settings["gestures"]["hold_s"]
        self._pinch: dict[int, PinchDetector] = {}
        self._static: dict[int, StaticGestureFilter] = {}
        # The held pose of each hand and when it became stable, and which hands already fired.
        self._pose_since: dict[int, tuple[str, float]] = {}
        self._pose_fired: set[int] = set()

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
                                      self._pinch_settings["end_ratio"],
                                      self._pinch_settings.get("release_grace_s", 0.0))
                self._pinch[hand_id] = pinch

            static = self._static.get(hand_id)
            if static is None:
                static = StaticGestureFilter(self._static_settings["min_score"],
                                             self._static_settings["stable_frames"])
                self._static[hand_id] = static

            was_pinching = pinch.is_pinching
            pinch_state = pinch.update(pinch_ratio(hand), now)
            if pinch_state.is_pinching and not was_pinching:
                events.append(GestureEvent(PINCH_START, hand_id))
            elif was_pinching and not pinch_state.is_pinching:
                events.append(GestureEvent(PINCH_END, hand_id))

            static.update(hand.static_gesture, hand.static_gesture_score)
            pose_event, pose_progress = self._update_held_pose(hand_id, static.stable, now)
            if pose_event is not None:
                events.append(GestureEvent(pose_event, hand_id))

            states[hand_id] = GestureState(
                hand_id=hand_id,
                is_pinching=pinch_state.is_pinching,
                pinch_strength=pinch_state.strength,
                pinch_ratio=pinch_state.ratio,
                is_pointing=is_pointing(hand) and not pinch_state.is_pinching,
                static_gesture=static.stable,
                pose_hold_progress=pose_progress,
            )

        # A hand that leaves the camera must not stay pinched.
        visible_ids = {hand.hand_id for hand in hands}
        for hand_id in list(self._pinch):
            if hand_id not in visible_ids:
                if self._pinch[hand_id].is_pinching:
                    events.append(GestureEvent(PINCH_END, hand_id))
                del self._pinch[hand_id]
                self._static.pop(hand_id, None)
                self._pose_since.pop(hand_id, None)
                self._pose_fired.discard(hand_id)

        return states, events

    def _update_held_pose(self, hand_id: int, stable_pose: str, now: float) -> tuple[str | None, float]:
        """Returns (event, progress). The event fires once per hold, after the pose is held for hold_s.

        It fires again only after the hand leaves the pose and holds it again.
        """
        event = HELD_POSES.get(stable_pose)
        if event is None:
            self._pose_since.pop(hand_id, None)
            self._pose_fired.discard(hand_id)
            return None, 0.0
        held = self._pose_since.get(hand_id)
        if held is None or held[0] != stable_pose:
            held = (stable_pose, now)
            self._pose_since[hand_id] = held
            self._pose_fired.discard(hand_id)
        if hand_id in self._pose_fired:
            return None, 0.0
        progress = (now - held[1]) / self._hold_s
        if progress >= 1.0:
            self._pose_fired.add(hand_id)
            return event, 0.0
        return None, progress
