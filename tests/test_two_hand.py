import unittest

import helpers  # noqa: F401
from gestures.two_hand import (TWO_HAND_DOUBLE_PINCH, TWO_HAND_PINCH_CANCEL, TWO_HAND_PINCH_END,
                               TWO_HAND_PINCH_MOVE, TWO_HAND_PINCH_START, TWO_HAND_SINGLE_PINCH,
                               TwoHandPinch, rect_between)

LEFT, RIGHT = (0.3, 0.4), (0.5, 0.6)


def types(events):
    return [event.type for event in events]


class TwoHandPinchTests(unittest.TestCase):
    def setUp(self):
        self.gesture = TwoHandPinch(single_max_spread=0.05, double_interval_s=0.45)

    def test_rectangle_between_pinch_points(self):
        rect = rect_between((0.5, 0.6), (0.3, 0.4))
        self.assertEqual([round(v, 4) for v in rect], [0.3, 0.4, 0.2, 0.2])

    def test_spread_draws_and_is_not_a_single_pinch(self):
        found = types(self.gesture.update([LEFT, RIGHT], 2, 0.0))
        found += types(self.gesture.update([(0.2, 0.3), (0.7, 0.8)], 2, 0.1))
        found += types(self.gesture.update(None, 2, 0.2))
        found += types(self.gesture.update(None, 2, 1.0))
        self.assertEqual(found, [TWO_HAND_PINCH_START, TWO_HAND_PINCH_MOVE, TWO_HAND_PINCH_END])

    def test_single_pinch_waits_for_double_interval(self):
        self.gesture.update([LEFT, RIGHT], 2, 0.0)
        self.assertEqual(types(self.gesture.update(None, 2, 0.1)), [TWO_HAND_PINCH_END])
        self.assertEqual(self.gesture.update(None, 2, 0.4), [])
        events = self.gesture.update(None, 2, 0.6)
        self.assertEqual(types(events), [TWO_HAND_SINGLE_PINCH])
        self.assertEqual([round(v, 4) for v in events[0].center], [0.4, 0.5])

    def test_double_pinch(self):
        self.gesture.update([LEFT, RIGHT], 2, 0.0)
        self.gesture.update(None, 2, 0.1)
        found = types(self.gesture.update([LEFT, RIGHT], 2, 0.3))
        found += types(self.gesture.update(None, 2, 0.4))
        found += types(self.gesture.update(None, 2, 2.0))
        self.assertEqual(found, [TWO_HAND_PINCH_START, TWO_HAND_PINCH_END, TWO_HAND_DOUBLE_PINCH])

    def test_lost_hand_cancels_without_single(self):
        self.gesture.update([LEFT, RIGHT], 2, 0.0)
        found = types(self.gesture.update(None, 1, 0.1))
        found += types(self.gesture.update(None, 1, 1.0))
        self.assertEqual(found, [TWO_HAND_PINCH_CANCEL])


if __name__ == "__main__":
    unittest.main()
