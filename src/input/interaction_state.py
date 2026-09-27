import time

from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import PEACE_SIGN as GESTURE_PEACE_SIGN
from gestures.gesture_detector import THUMBS_DOWN as GESTURE_THUMBS_DOWN
from gestures.gesture_detector import THUMBS_UP as GESTURE_THUMBS_UP
from gestures.gesture_detector import GestureEvent, GestureState
from gestures.two_hand import TwoHandEvent, TwoHandPinch
from input.events import (HOLD_PROGRESS, PEACE_SIGN, POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE,
                          POINTER_UP, SCROLL, THUMBS_DOWN, THUMBS_UP, Pointer, SurfaceInputEvent)
from utils.geometry import Point
from vision.hand_data import HandData

# Scroll movements smaller than this, in canvas units, are treated as tracking noise.
MIN_SCROLL_DY = 0.002
# A finger slowing below this fraction of its flick speed counts as the end of a flick.
FLICK_STOP_FRACTION = 0.3
# Held poses and the contract events they produce.
POSE_EVENTS = {GESTURE_THUMBS_DOWN: THUMBS_DOWN, GESTURE_THUMBS_UP: THUMBS_UP, GESTURE_PEACE_SIGN: PEACE_SIGN}


class _ScrollState:
    """Per-hand scroll tracking: finger speed and any coasting after a flick."""

    def __init__(self) -> None:
        self.speed = 0.0              # canvas heights per second, positive = down
        self.coast_speed = 0.0
        self.coast_until: float | None = None
        self.coast_started: float | None = None


class InteractionState:
    """Turns tracked hands and gesture states into canvas pointers and input events.

    Per hand and frame the order is: pointer_move, then scroll, then pointer_down or
    pointer_up. Pose and two-hand events follow, then hold_progress when it changed.

    A pinch presses (pointer_down) only after it has been held for hold_s; a shorter pinch
    sends nothing. When a second hand starts pinching, the first hand's press is cancelled so
    a two-hand gesture never activates a widget. Hands in a two-hand gesture send no
    pointer_down or pointer_up until they have released their pinch.
    """

    def __init__(self, smoothing: float, settings: dict) -> None:
        # 0 = raw and jittery, closer to 1 = smoother but laggier.
        self._smoothing = smoothing
        self._flick_min_speed = settings["scroll"]["flick_min_speed"]
        self._coast_s = settings["scroll"]["coast_s"]
        self._hold_s = settings["gestures"]["hold_s"]
        self._two_hand = TwoHandPinch(self._hold_s, settings["two_hand"]["hold_max_spread"])
        self._positions: dict[int, Point] = {}
        self._down: set[int] = set()
        self._suppressed: set[int] = set()
        # When each hand's current pinch began, until it presses.
        self._pinch_since: dict[int, float] = {}
        self._hold_sent = 0.0
        self._scroll: dict[int, _ScrollState] = {}
        self._last_time: float | None = None

    def update(
        self,
        hands: list[HandData],
        states: dict[int, GestureState],
        gesture_events: list[GestureEvent],
        mapper: CoordinateMapper,
        now: float | None = None,
    ) -> tuple[list[Pointer], list[SurfaceInputEvent]]:
        now = time.monotonic() if now is None else now
        dt = 0.0 if self._last_time is None else max(0.0, now - self._last_time)
        self._last_time = now

        pointers: list[Pointer] = []
        events: list[SurfaceInputEvent] = []

        pinching = [hand for hand in hands if states[hand.hand_id].is_pinching]
        both_pinching = len(hands) == 2 and len(pinching) == 2
        if both_pinching and not self._two_hand.active:
            # The first hand's press was only the start of a two-hand gesture: cancel it.
            for hand in hands:
                if hand.hand_id in self._down:
                    self._down.discard(hand.hand_id)
                    events.append(SurfaceInputEvent(POINTER_CANCEL, hand.hand_id,
                                                    *self._positions[hand.hand_id]))
                self._suppressed.add(hand.hand_id)
                self._pinch_since.pop(hand.hand_id, None)

        hold_progress = 0.0
        for hand in hands:
            hand_id = hand.hand_id
            state = states[hand_id]
            previous = self._positions.get(hand_id)
            position = self._smooth(previous, mapper.to_surface(hand.index_tip))
            self._positions[hand_id] = position
            events.append(SurfaceInputEvent(POINTER_MOVE, hand_id, *position))

            scroll_dy = self._update_scroll(hand_id, state, previous, position, dt, now)
            if scroll_dy is not None:
                events.append(SurfaceInputEvent(SCROLL, hand_id, *position, dy=round(scroll_dy, 4)))

            if hand_id in self._suppressed:
                if not state.is_pinching:
                    self._suppressed.discard(hand_id)
            elif state.is_pinching and hand_id not in self._down:
                since = self._pinch_since.setdefault(hand_id, now)
                if now - since >= self._hold_s:
                    del self._pinch_since[hand_id]
                    self._down.add(hand_id)
                    events.append(SurfaceInputEvent(POINTER_DOWN, hand_id, *position))
                else:
                    hold_progress = max(hold_progress, (now - since) / self._hold_s)
            elif not state.is_pinching:
                # A pinch released before hold_s never pressed, so it sends nothing.
                self._pinch_since.pop(hand_id, None)
                if hand_id in self._down:
                    self._down.discard(hand_id)
                    events.append(SurfaceInputEvent(POINTER_UP, hand_id, *position))
            hold_progress = max(hold_progress, state.pose_hold_progress)

            pointers.append(Pointer(id=hand_id, x=position[0], y=position[1],
                                    is_down=hand_id in self._down,
                                    gesture=state.static_gesture,
                                    is_pinching=state.is_pinching))

        for gesture_event in gesture_events:
            if gesture_event.type in POSE_EVENTS:
                x, y = self._positions.get(gesture_event.hand_id, (0.5, 0.5))
                events.append(SurfaceInputEvent(POSE_EVENTS[gesture_event.type], gesture_event.hand_id, x, y))

        pinch_points = None
        if both_pinching:
            pinch_points = [mapper.to_surface(_pinch_point(hand)) for hand in pinching]
        for two_hand_event in self._two_hand.update(pinch_points, len(hands), now):
            events.append(_to_input_event(two_hand_event))

        # One value for whichever hold is closest to firing; sent only when it changes.
        hold_progress = round(min(1.0, max(hold_progress, self._two_hand.hold_progress)), 2)
        if hold_progress != self._hold_sent:
            self._hold_sent = hold_progress
            events.append(SurfaceInputEvent(HOLD_PROGRESS, None, progress=hold_progress))

        # A lost hand gets pointer_cancel, whether or not it was pressed, so the shell can
        # abandon any press or drag and hide the cursor.
        visible_ids = {hand.hand_id for hand in hands}
        for hand_id in list(self._positions):
            if hand_id not in visible_ids:
                self._down.discard(hand_id)
                self._suppressed.discard(hand_id)
                self._pinch_since.pop(hand_id, None)
                self._scroll.pop(hand_id, None)
                events.append(SurfaceInputEvent(POINTER_CANCEL, hand_id, *self._positions[hand_id]))
                del self._positions[hand_id]

        pointers.sort(key=lambda pointer: pointer.x)
        return pointers, events

    def _smooth(self, previous: Point | None, raw: Point) -> Point:
        if previous is None:
            return raw
        keep = self._smoothing
        return (keep * previous[0] + (1 - keep) * raw[0],
                keep * previous[1] + (1 - keep) * raw[1])

    def _update_scroll(self, hand_id: int, state: GestureState, previous: Point | None,
                       position: Point, dt: float, now: float) -> float | None:
        """Returns this frame's scroll amount for the hand, or None when it is not scrolling.

        While pointing, dy follows the finger. A fast movement that stops abruptly, or a
        pointing pose that ends while moving fast, starts a coast: dy keeps coming at a
        decreasing rate for coast_s seconds, like a flicked list on a phone.
        """
        scroll = self._scroll.setdefault(hand_id, _ScrollState())

        if state.is_pointing and previous is not None and dt > 0:
            dy = position[1] - previous[1]
            speed = dy / dt
            flick_ended = (abs(scroll.speed) >= self._flick_min_speed
                           and abs(speed) < abs(scroll.speed) * FLICK_STOP_FRACTION)
            if flick_ended:
                self._start_coast(scroll, now)
            elif abs(dy) >= MIN_SCROLL_DY:
                scroll.coast_until = None
            scroll.speed = speed
            if scroll.coast_until is None:
                return dy if abs(dy) >= MIN_SCROLL_DY else None
            return self._coast_step(scroll, dt, now)

        if not state.is_pointing and abs(scroll.speed) >= self._flick_min_speed \
                and scroll.coast_until is None:
            self._start_coast(scroll, now)
        scroll.speed = 0.0
        if state.is_pinching:
            scroll.coast_until = None
        return self._coast_step(scroll, dt, now)

    def _start_coast(self, scroll: _ScrollState, now: float) -> None:
        scroll.coast_speed = scroll.speed
        scroll.coast_started = now
        scroll.coast_until = now + self._coast_s

    def _coast_step(self, scroll: _ScrollState, dt: float, now: float) -> float | None:
        if scroll.coast_until is None:
            return None
        if now >= scroll.coast_until or dt <= 0:
            if now >= scroll.coast_until:
                scroll.coast_until = None
            return None
        # Speed falls linearly from the flick speed to zero over coast_s.
        remaining = (scroll.coast_until - now) / self._coast_s
        dy = scroll.coast_speed * remaining * dt
        return dy if abs(dy) >= MIN_SCROLL_DY / 4 else None


def _pinch_point(hand: HandData) -> Point:
    """Midpoint between thumb tip and index tip, where the fingers actually touch."""
    return ((hand.thumb_tip[0] + hand.index_tip[0]) / 2, (hand.thumb_tip[1] + hand.index_tip[1]) / 2)


def _to_input_event(event: TwoHandEvent) -> SurfaceInputEvent:
    if event.rect is not None:
        x, y, width, height = event.rect
        return SurfaceInputEvent(event.type, None, x, y, width=width, height=height)
    if event.center is not None:
        return SurfaceInputEvent(event.type, None, *event.center)
    return SurfaceInputEvent(event.type, None)
