from dataclasses import dataclass

import config
from vision.hand_data import HandData


@dataclass
class TrackedHand:
    """A hand after smoothing and pinch detection, in normalized screen space."""

    x: float
    y: float
    pinch: bool
    gesture: str
    source: HandData

    def to_dict(self) -> dict:
        return {"x": round(self.x, 4), "y": round(self.y, 4),
                "pinch": self.pinch, "gesture": self.gesture}


class GestureDetector:
    """Turns raw hand data into stable, per-hand pointer and pinch state."""

    def __init__(self) -> None:
        self.previous_hand_count = 0
        self._reset_slots()

    def _reset_slots(self) -> None:
        self.pinch_states = [False] * config.MAX_HANDS
        self.smooth_points: list[tuple[float, float] | None] = [None] * config.MAX_HANDS

    def update(self, hands: list[HandData]) -> list[TrackedHand]:
        # Handedness labels flicker, so hands are identified by position:
        # slot 0 is always the leftmost hand on screen.
        ordered = sorted(hands, key=lambda hand: hand.index_tip[0])

        # A hand appearing or disappearing shifts the slots, so per-slot state is stale.
        if len(ordered) != self.previous_hand_count:
            self._reset_slots()
            self.previous_hand_count = len(ordered)

        tracked = []
        for slot, hand in enumerate(ordered):
            if not self.pinch_states[slot] and hand.pinch_ratio < config.PINCH_START_RATIO:
                self.pinch_states[slot] = True
            elif self.pinch_states[slot] and hand.pinch_ratio > config.PINCH_END_RATIO:
                self.pinch_states[slot] = False

            raw_x, raw_y = hand.index_tip
            previous = self.smooth_points[slot]
            if previous is None:
                smooth = (raw_x, raw_y)
            else:
                keep = config.SMOOTHING
                smooth = (keep * previous[0] + (1 - keep) * raw_x,
                          keep * previous[1] + (1 - keep) * raw_y)
            self.smooth_points[slot] = smooth

            tracked.append(TrackedHand(x=smooth[0], y=smooth[1], pinch=self.pinch_states[slot],
                                       gesture=hand.gesture, source=hand))
        return tracked
