import unittest

from helpers import make_hand
from gestures.gesture_detector import PINCH_END, PINCH_START, THUMBS_DOWN, GestureDetector
from gestures.hand_pose import is_pointing
from gestures.static_gestures import StaticGestureFilter
from vision.hand_identity import HandIdentifier

SETTINGS = {
    "pinch": {"start_ratio": 0.25, "end_ratio": 0.35},
    "two_hand": {"single_max_spread": 0.05, "double_interval_s": 0.45},
    "thumbs_down": {"hold_s": 0.5},
    "scroll": {"flick_min_speed": 1.0, "coast_s": 0.5},
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

    def test_quick_second_pinch_is_just_a_pinch(self):
        detector = GestureDetector(SETTINGS)
        detector.update([make_hand(pinch_ratio=PINCHED)], now=0.0)
        detector.update([make_hand(pinch_ratio=OPEN)], now=0.15)
        _, events = detector.update([make_hand(pinch_ratio=PINCHED)], now=0.3)
        self.assertEqual(types(events), [PINCH_START])

    def test_thumbs_down_fires_once_after_hold(self):
        detector = GestureDetector(SETTINGS)
        hand = make_hand(gesture="Thumb_Down", score=0.9)
        fired_at = []
        for frame in range(40):
            now = frame * 0.05
            _, events = detector.update([hand], now=now)
            if THUMBS_DOWN in types(events):
                fired_at.append(now)
        # Stable after 3 frames (0.10 s), then held 0.5 s.
        self.assertEqual(len(fired_at), 1)
        self.assertAlmostEqual(fired_at[0], 0.6, places=5)

    def test_thumbs_down_released_early_does_not_fire(self):
        detector = GestureDetector(SETTINGS)
        found = []
        for frame in range(8):
            _, events = detector.update([make_hand(gesture="Thumb_Down", score=0.9)], now=frame * 0.05)
            found += types(events)
        for frame in range(8, 30):
            _, events = detector.update([make_hand(gesture="Open_Palm", score=0.9)], now=frame * 0.05)
            found += types(events)
        self.assertNotIn(THUMBS_DOWN, found)

    def test_pointing_state(self):
        detector = GestureDetector(SETTINGS)
        states, _ = detector.update([make_hand(pointing=True)], now=0.0)
        self.assertTrue(states[0].is_pointing)
        states, _ = detector.update([make_hand()], now=0.1)
        self.assertFalse(states[0].is_pointing)


class HandPoseTests(unittest.TestCase):
    def test_pointing_pose(self):
        self.assertTrue(is_pointing(make_hand(pointing=True)))

    def test_default_hand_is_not_pointing(self):
        self.assertFalse(is_pointing(make_hand()))


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
