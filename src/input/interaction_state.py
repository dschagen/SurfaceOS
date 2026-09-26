from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import DOUBLE_PINCH as GESTURE_DOUBLE_PINCH
from gestures.gesture_detector import GestureEvent, GestureState
from input.events import (DOUBLE_PINCH, POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE, POINTER_UP,
                          Pointer, SurfaceInputEvent)
from utils.geometry import Point
from vision.hand_data import HandData


class InteractionState:
    """Turns tracked hands and gesture states into canvas pointers and pointer events.

    Per hand and frame the order is: pointer_move, then double_pinch if one was recognized,
    then pointer_down or pointer_up. The shell therefore always knows where a press happens,
    and learns about a double pinch before the pointer_down that belongs to it.
    """

    def __init__(self, smoothing: float) -> None:
        # 0 = raw and jittery, closer to 1 = smoother but laggier.
        self._smoothing = smoothing
        self._positions: dict[int, Point] = {}
        self._down: set[int] = set()

    def update(
        self,
        hands: list[HandData],
        states: dict[int, GestureState],
        gesture_events: list[GestureEvent],
        mapper: CoordinateMapper,
    ) -> tuple[list[Pointer], list[SurfaceInputEvent]]:
        pointers: list[Pointer] = []
        events: list[SurfaceInputEvent] = []
        double_pinch_ids = {e.hand_id for e in gesture_events if e.type == GESTURE_DOUBLE_PINCH}

        for hand in hands:
            hand_id = hand.hand_id
            raw = mapper.to_surface(hand.index_tip)
            previous = self._positions.get(hand_id)
            if previous is None:
                position = raw
            else:
                keep = self._smoothing
                position = (keep * previous[0] + (1 - keep) * raw[0],
                            keep * previous[1] + (1 - keep) * raw[1])
            self._positions[hand_id] = position
            events.append(SurfaceInputEvent(POINTER_MOVE, hand_id, *position))

            if hand_id in double_pinch_ids:
                events.append(SurfaceInputEvent(DOUBLE_PINCH, hand_id, *position))

            state = states[hand_id]
            if state.is_pinching and hand_id not in self._down:
                self._down.add(hand_id)
                events.append(SurfaceInputEvent(POINTER_DOWN, hand_id, *position))
            elif not state.is_pinching and hand_id in self._down:
                self._down.discard(hand_id)
                events.append(SurfaceInputEvent(POINTER_UP, hand_id, *position))

            pointers.append(Pointer(id=hand_id, x=position[0], y=position[1],
                                    is_down=hand_id in self._down,
                                    gesture=state.static_gesture))

        # A lost hand gets pointer_cancel, whether or not it was pressed, so the shell can
        # abandon any press or drag and hide the cursor.
        visible_ids = {hand.hand_id for hand in hands}
        for hand_id in list(self._positions):
            if hand_id not in visible_ids:
                self._down.discard(hand_id)
                events.append(SurfaceInputEvent(POINTER_CANCEL, hand_id, *self._positions[hand_id]))
                del self._positions[hand_id]

        pointers.sort(key=lambda pointer: pointer.x)
        return pointers, events