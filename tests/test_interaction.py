import unittest

from helpers import make_hand
from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import GestureDetector
from input.events import (HOLD_PROGRESS, PEACE_SIGN, POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE,
                          POINTER_UP, SCROLL, THUMBS_DOWN, TWO_HAND_HOLD, TWO_HAND_PINCH_END,
                          TWO_HAND_PINCH_START)
from input.interaction_state import InteractionState
from test_gestures import OPEN, PINCHED, SETTINGS


def types(events):
    """Event types without the hold_progress updates, which tests check separately."""
    return [event.type for event in events if event.type != HOLD_PROGRESS]


def progress(events):
    return [event.progress for event in events if event.type == HOLD_PROGRESS]


class InteractionTests(unittest.TestCase):
    def setUp(self):
        self.gestures = GestureDetector(SETTINGS)
        self.interaction = InteractionState(0.0, SETTINGS)
        self.mapper = CoordinateMapper(mirror_x=True)
        self.now = 0.0

    def step(self, hands, dt=0.1):
        self.now += dt
        states, gesture_events = self.gestures.update(hands, now=self.now)
        return self.interaction.update(hands, states, gesture_events, self.mapper, now=self.now)

    def test_every_frame_moves(self):
        _, events = self.step([make_hand(tip=(0.3, 0.4))])
        self.assertEqual(types(events), [POINTER_MOVE])
        self.assertAlmostEqual(events[0].x, 0.7)  # mirrored into canvas space

    def hold_pinch(self, frames=6):
        """Pinches one hand for frames x 0.1 s and returns all events."""
        found = []
        for _ in range(frames):
            _, events = self.step([make_hand(pinch_ratio=PINCHED)])
            found += events
        return found

    def test_pinch_presses_after_hold_then_releases_once(self):
        found = self.hold_pinch(5)                     # 0.4 s since the pinch began
        self.assertNotIn(POINTER_DOWN, types(found))
        _, events = self.step([make_hand(pinch_ratio=PINCHED)])   # 0.5 s
        self.assertEqual(types(events), [POINTER_MOVE, POINTER_DOWN])
        _, events = self.step([make_hand(pinch_ratio=PINCHED)])
        self.assertEqual(types(events), [POINTER_MOVE])  # holding: movement only, no repeat press
        _, events = self.step([make_hand(pinch_ratio=OPEN)])
        self.assertEqual(types(events), [POINTER_MOVE, POINTER_UP])

    def test_release_is_sent_from_last_firmly_pinched_position(self):
        for _ in range(6):
            self.step([make_hand(tip=(0.4, 0.5), pinch_ratio=PINCHED)])
        # Fingers opening: still pinching by hysteresis, but the fingertip drifts.
        self.step([make_hand(tip=(0.43, 0.52), pinch_ratio=0.3)])
        _, events = self.step([make_hand(tip=(0.47, 0.55), pinch_ratio=OPEN)])
        up = next(e for e in events if e.type == POINTER_UP)
        self.assertAlmostEqual(up.x, 0.6)    # mirrored 0.4, where the fingers were closed
        self.assertAlmostEqual(up.y, 0.5)

    def test_short_pinch_sends_no_press(self):
        found = self.hold_pinch(3)
        _, events = self.step([make_hand(pinch_ratio=OPEN)])
        found += events
        self.assertNotIn(POINTER_DOWN, types(found))
        self.assertNotIn(POINTER_UP, types(found))
        self.assertEqual(progress(found)[-1], 0.0)     # the ring empties again

    def test_pinch_hold_progress_fills_then_clears_on_press(self):
        found = self.hold_pinch(6)
        values = progress(found)
        self.assertEqual(values[:-1], sorted(values[:-1]))
        self.assertGreaterEqual(values[-2], 0.8)
        self.assertEqual(values[-1], 0.0)

    def test_lost_hand_cancels(self):
        self.step([make_hand(pinch_ratio=PINCHED)])
        pointers, events = self.step([])
        self.assertEqual(pointers, [])
        self.assertEqual(types(events), [POINTER_CANCEL])

    def test_second_hand_pinching_cancels_first_press(self):
        for _ in range(6):
            self.step([make_hand(0, tip=(0.3, 0.5), pinch_ratio=PINCHED),
                       make_hand(1, tip=(0.7, 0.5), pinch_ratio=OPEN)])
        _, events = self.step([make_hand(0, tip=(0.3, 0.5), pinch_ratio=PINCHED),
                               make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)])
        found = types(events)
        self.assertEqual(found[0], POINTER_CANCEL)
        self.assertNotIn(POINTER_DOWN, found)
        self.assertIn(TWO_HAND_PINCH_START, found)

    def test_pointers_report_pinch_during_two_hand_gesture(self):
        both = [make_hand(0, tip=(0.3, 0.5), pinch_ratio=PINCHED),
                make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)]
        pointers, _ = self.step(both)
        self.assertTrue(all(p.is_pinching and not p.is_down for p in pointers))

    def test_two_hand_release_sends_no_pointer_up(self):
        both = [make_hand(0, tip=(0.3, 0.5), pinch_ratio=PINCHED),
                make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)]
        self.step(both)
        _, events = self.step([make_hand(0, tip=(0.3, 0.5), pinch_ratio=OPEN),
                               make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)])
        self.assertIn(TWO_HAND_PINCH_END, types(events))
        self.assertNotIn(POINTER_UP, types(events))
        # The hand still pinching must release before it can press again.
        _, events = self.step([make_hand(0, tip=(0.3, 0.5), pinch_ratio=OPEN),
                               make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)])
        self.assertNotIn(POINTER_DOWN, types(events))

    def test_pointing_scrolls_with_finger(self):
        self.step([make_hand(tip=(0.5, 0.4), pointing=True)])
        _, events = self.step([make_hand(tip=(0.5, 0.45), pointing=True)])
        scroll = [e for e in events if e.type == SCROLL]
        self.assertEqual(len(scroll), 1)
        self.assertAlmostEqual(scroll[0].dy, 0.05)  # finger moved down, dy positive

    def test_open_hand_does_not_scroll(self):
        self.step([make_hand(tip=(0.5, 0.4))])
        _, events = self.step([make_hand(tip=(0.5, 0.45))])
        self.assertNotIn(SCROLL, types(events))

    def test_flick_keeps_scrolling_then_stops(self):
        self.step([make_hand(tip=(0.5, 0.2), pointing=True)], dt=0.05)
        self.step([make_hand(tip=(0.5, 0.3), pointing=True)], dt=0.05)   # 2 canvas heights per second
        coast = []
        for _ in range(20):                                                 # finger stops, still pointing
            _, events = self.step([make_hand(tip=(0.5, 0.3), pointing=True)], dt=0.05)
            coast += [e.dy for e in events if e.type == SCROLL]
        self.assertGreater(len(coast), 3)
        self.assertTrue(all(dy > 0 for dy in coast))
        self.assertTrue(all(a >= b for a, b in zip(coast, coast[1:])))  # slows down
        self.assertLess(len(coast), 12)                                   # stops within coast_s

    def test_thumbs_down_event(self):
        found = []
        for _ in range(12):
            _, events = self.step([make_hand(gesture="Thumb_Down", score=0.9)])
            found += types(events)
        self.assertEqual(found.count(THUMBS_DOWN), 1)

    def test_peace_sign_event(self):
        found = []
        for _ in range(12):
            _, events = self.step([make_hand(gesture="Victory", score=0.9)])
            found += types(events)
        self.assertEqual(found.count(PEACE_SIGN), 1)

    def test_two_hand_still_pinch_holds_once_without_pointer_press(self):
        both = [make_hand(0, tip=(0.3, 0.5), pinch_ratio=PINCHED),
                make_hand(1, tip=(0.7, 0.5), pinch_ratio=PINCHED)]
        found = []
        for _ in range(10):
            _, events = self.step(both)
            found += events
        self.assertEqual(types(found).count(TWO_HAND_HOLD), 1)
        self.assertNotIn(POINTER_DOWN, types(found))
        self.assertGreater(max(progress(found)), 0.7)


if __name__ == "__main__":
    unittest.main()
