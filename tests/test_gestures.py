import unittest

from helpers import make_hand
from gestures.double_pinch import DoublePinchDetector
from gestures.gesture_detector import DOUBLE_PINCH, PINCH_END, PINCH_START, GestureDetector
from gestures.static_gestures import StaticGestureFilter
from vision.hand_identity import HandIdentifier

SETTINGS = {
    "pinch": {"start_ratio": 0.25, "end_ratio": 0.35},
    "double_pinch": {"max_interval_s": 0.45, "max_distance": 0.08},
    "static_gestures": {"min_score": 0.6, "stable_frames": 3},
}

PINCHED = 0.1
OPEN = 0.9


def types(events):
    return [event.type for event in events]


class GestureDetectorTests(unittest.TestCase):
    def test_pinch_events(self):
        detector = GestureDetector(SETTINGS)
        _, events = detector.update([make_hand(pinch_ratio=PINCHED)], now=0.0)
        self.assertEqual(types(events), [PINCH_START])
        _, events = detector.update([make_hand(pinch_ratio=PINCHED)], now=0.1)
        self.assertEqual(events, [])
        _, events = detector.update([make_hand(pinch_ratio=OPEN)], now=0.2)
        self.assertEqual(types(events), [PINCH_END])

    def test_lost_hand_ends_pinch(self):
        detector = GestureDetector(SETTINGS)
        detector.update([make_hand(pinch_ratio=PINCHED)], now=0.0)
        _, events = detector.update([], now=0.1)
        self.assertEqual(types(events), [PINCH_END])

    def test_quick_second_pinch_is_double_pinch(self):
        detector = GestureDetector(SETTINGS)
        detector.update([make_hand(pinch_ratio=PINCHED)], now=0.0)
        detector.update([make_hand(pinch_ratio=OPEN)], now=0.15)
        _, events = detector.update([make_hand(pinch_ratio=PINCHED)], now=0.3)
        self.assertEqual(types(events), [PINCH_START, DOUBLE_PINCH])

    def test_slow_second_pinch_is_not_double_pinch(self):
        detector = GestureDetector(SETTINGS)
        detector.update([make_hand(pinch_ratio=PINCHED)], now=0.0)
        detector.update([make_hand(pinch_ratio=OPEN)], now=0.3)
        _, events = detector.update([make_hand(pinch_ratio=PINCHED)], now=1.0)
        self.assertEqual(types(events), [PINCH_START])

    def test_static_gesture_event_after_stable_frames(self):
        detector = GestureDetector(SETTINGS)
        hand = make_hand(gesture="Open_Palm", score=0.9)
        found = []
        for frame in range(4):
            _, events = detector.update([hand], now=frame * 0.03)
            found.extend(types(events))
        self.assertEqual(found, ["OPEN_PALM"])


class DoublePinchDetectorTests(unittest.TestCase):
    def test_far_apart_pinches_do_not_count(self):
        detector = DoublePinchDetector(max_interval_s=0.45, max_distance=0.08)
        self.assertFalse(detector.on_pinch_start(0, (0.2, 0.2), 0.0))
        self.assertFalse(detector.on_pinch_start(0, (0.6, 0.6), 0.2))

    def test_third_pinch_starts_new_sequence(self):
        detector = DoublePinchDetector(max_interval_s=0.45, max_distance=0.08)
        detector.on_pinch_start(0, (0.5, 0.5), 0.0)
        self.assertTrue(detector.on_pinch_start(0, (0.5, 0.5), 0.2))
        self.assertFalse(detector.on_pinch_start(0, (0.5, 0.5), 0.3))


class StaticGestureFilterTests(unittest.TestCase):
    def test_ignores_flicker(self):
        gesture_filter = StaticGestureFilter(min_score=0.6, stable_frames=3)
        results = [gesture_filter.update(label, 0.9)
                   for label in ["Thumb_Up", "Victory", "Thumb_Up", "Victory"]]
        self.assertEqual(results, [None, None, None, None])

    def test_low_score_counts_as_none(self):
        gesture_filter = StaticGestureFilter(min_score=0.6, stable_frames=1)
        self.assertIsNone(gesture_filter.update("Thumb_Up", 0.2))


class HandIdentifierTests(unittest.TestCase):
    def test_ids_follow_hands_when_order_swaps(self):
        identifier = HandIdentifier(match_distance=0.2)
        first = identifier.assign([(0.2, 0.5), (0.8, 0.5)])
        second = identifier.assign([(0.82, 0.5), (0.21, 0.5)])
        self.assertEqual(second, [first[1], first[0]])

    def test_new_hand_gets_new_id(self):
        identifier = HandIdentifier(match_distance=0.2)
        first = identifier.assign([(0.2, 0.5)])
        second = identifier.assign([(0.2, 0.5), (0.8, 0.5)])
        self.assertEqual(second[0], first[0])
        self.assertNotEqual(second[1], first[0])


if __name__ == "__main__":
    unittest.main()
