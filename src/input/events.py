from dataclasses import dataclass

# Names match the shared integration contract in CLAUDE.md.
POINTER_MOVE = "pointer_move"
POINTER_DOWN = "pointer_down"
POINTER_UP = "pointer_up"
POINTER_CANCEL = "pointer_cancel"
DOUBLE_PINCH = "double_pinch"


@dataclass
class Pointer:
    """Current state of one hand as a pointer on the canvas. x and y are 0-1."""

    id: int
    x: float
    y: float
    is_down: bool
    gesture: str


@dataclass
class SurfaceInputEvent:
    """A pointer or gesture event for one hand, in normalized canvas coordinates."""

    type: str
    hand_id: int
    x: float
    y: float