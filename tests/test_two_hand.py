import unittest

import helpers  # noqa: F401
from gestures.two_hand import (TWO_HAND_HOLD, TWO_HAND_PINCH_CANCEL, TWO_HAND_PINCH_END,
                               TWO_HAND_PINCH_MOVE, TWO_HAND_PINCH_START, TwoHandPinch, rect_between)

LEFT, RIGHT = (0.3, 0.4), (0.5, 0.6)


def types(events):
    return [event.type for event in events]


class TwoHandPinchTests(unittest.TestCase):
    def setUp(self):
        self.gesture = TwoHandPinch(hold_s=0.5, hold_max_spread=0.05)

    def test_rectangle_between_pinch_points(self):
        rect = rect_between((0.5, 0.6), (0.3, 0.4))
        self.assertEqual([round(v, 4) for v in rect], [0.3, 0.4, 0.2, 0.2])

    def test_spread_draws_and_never_holds(self):
        found = types(self.gesture.update([LEFT, RIGHT], 2, 0.0))
        found += types(self.gesture.update([(0.2, 0.3), (0.7, 0.8)], 2, 0.1))
        found += types(self.gesture.update([(0.2, 0.3), (0.7, 0.8)], 2, 1.0))
        found += types(self.gesture.update(None, 2, 1.1))
        self.assertEqual(found, [TWO_HAND_PINCH_START, TWO_HAND_PINCH_MOVE, TWO_HAND_PINCH_MOVE,
                                 TWO_HAND_PINCH_END])

    def test_still_pinch_holds_once_after_hold_time(self):
        found = []
        for frame in range(20):
            events = self.gesture.update([LEFT, RIGHT], 2, frame * 0.05)
            found += [(frame * 0.05, e) for e in events if e.type == TWO_HAND_HOLD]
        self.assertEqual(len(found), 1)
        when, event = found[0]
        self.assertAlmostEqual(when, 0.5)
        self.assertEqual([round(v, 4) for v in event.center], [0.4, 0.5])

    def test_hold_progress_fills_then_clears(self):
        self.gesture.update([LEFT, RIGHT], 2, 0.0)
        self.gesture.update([LEFT, RIGHT], 2, 0.25)
        self.assertAlmostEqual(self.gesture.hold_progress, 0.5)
        self.gesture.update([LEFT, RIGHT], 2, 0.5)
        self.assertEqual(self.gesture.hold_progress, 0.0)

    def test_release_before_hold_time_does_not_hold(self):
        found = types(self.gesture.update([LEFT, RIGHT], 2, 0.0))
        found += types(self.gesture.update(None, 2, 0.3))
        found += types(self.gesture.update(None, 2, 1.0))
        self.assertEqual(found, [TWO_HAND_PINCH_START, TWO_HAND_PINCH_END])
        self.assertEqual(self.gesture.hold_progress, 0.0)

    def test_lost_hand_cancels(self):
        self.gesture.update([LEFT, RIGHT], 2, 0.0)
        found = types(self.gesture.update(None, 1, 0.1))
        found += types(self.gesture.update(None, 1, 1.0))
        self.assertEqual(found, [TWO_HAND_PINCH_CANCEL])


if __name__ == "__main__":
    unittest.main()
