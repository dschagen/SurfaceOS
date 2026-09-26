from input.events import Pointer, SurfaceInputEvent
from utils.geometry import clamp

PROTOCOL_VERSION = 1
SOURCE_HAND = "hand"
# Debug-only snapshot of every tracked hand; the shell's input handler ignores it.
HAND_DEBUG = "hand_debug"


class PrimaryPointer:
    """Chooses which hand drives the single contract pointer.

    The primary hand keeps control until it leaves the camera. A replacement is only chosen
    among hands that are not pressed, so the shell never sees a press without a pointer_down.
    """

    def __init__(self) -> None:
        self.hand_id: int | None = None

    def select(self, pointers: list[Pointer]) -> None:
        visible = {pointer.id for pointer in pointers}
        if self.hand_id in visible:
            return
        candidates = sorted(pointer.id for pointer in pointers if not pointer.is_down)
        self.hand_id = candidates[0] if candidates else None


def encode(event: SurfaceInputEvent, source: str = SOURCE_HAND) -> dict:
    """Builds the contract message. Out-of-range coordinates are clamped to the canvas."""
    return {
        "version": PROTOCOL_VERSION,
        "type": event.type,
        "x": round(clamp(event.x), 4),
        "y": round(clamp(event.y), 4),
        "source": source,
    }


def hands_debug_message(pointers: list[Pointer], primary_id: int | None) -> dict:
    """Every tracked hand at the same clamped canvas position its pointer events would carry."""
    return {
        "version": PROTOCOL_VERSION,
        "type": HAND_DEBUG,
        "hands": [
            {
                "id": pointer.id,
                "x": round(clamp(pointer.x), 4),
                "y": round(clamp(pointer.y), 4),
                "pinching": pointer.is_down,
                "primary": pointer.id == primary_id,
            }
            for pointer in pointers
        ],
    }


def primary_messages(events: list[SurfaceInputEvent], primary: PrimaryPointer,
                     pointers: list[Pointer]) -> list[dict]:
    """Encodes this frame's events for the primary hand, then updates the primary choice.

    Selection happens after encoding so a lost primary hand still delivers its pointer_cancel.
    """
    messages = [encode(event) for event in events if event.hand_id == primary.hand_id]
    primary.select(pointers)
    return messages