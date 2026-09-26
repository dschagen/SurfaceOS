from dataclasses import dataclass

from gestures.two_hand import (TWO_HAND_DOUBLE_PINCH, TWO_HAND_PINCH_CANCEL,  # noqa: F401
                               TWO_HAND_PINCH_END, TWO_HAND_PINCH_MOVE, TWO_HAND_PINCH_START,
                               TWO_HAND_SINGLE_PINCH)

# Names match the shared integration contract (UX_FLOW.md and docs/input.md).
POINTER_MOVE = "pointer_move"
POINTER_DOWN = "pointer_down"
POINTER_UP = "pointer_up"
POINTER_CANCEL = "pointer_cancel"
SCROLL = "scroll"
THUMBS_DOWN = "thumbs_down"

# Events that belong to the single contract pointer and follow the primary hand.
POINTER_EVENTS = {POINTER_MOVE, POINTER_DOWN, POINTER_UP, POINTER_CANCEL, SCROLL}


@dataclass
class Pointer:
    """Current state of one hand as a pointer on the canvas. x and y are 0-1."""

    id: int
    x: float
    y: float
    # True while this hand's pinch is pressing the contract pointer.
    is_down: bool
    gesture: str
    # True while the fingers are pinched, including during a two-hand gesture when is_down is False.
    is_pinching: bool = False


@dataclass
class SurfaceInputEvent:
    """An input event in normalized canvas coordinates.

    hand_id is None for two-hand events. Optional fields are set only by the events that use them.
    """

    type: str
    hand_id: int | None
    x: float | None = None
    y: float | None = None
    # Two-hand rectangle size, for two_hand_pinch_start, _move and _end.
    width: float | None = None
    height: float | None = None
    # Finger movement for scroll; positive means the finger moved down.
    dy: float | None = None