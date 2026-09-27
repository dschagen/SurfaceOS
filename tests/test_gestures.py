import unittest

from helpers import make_hand
from gestures.gesture_detector import PEACE_SIGN, PINCH_END, PINCH_START, THUMBS_DOWN, THUMBS_UP, GestureDetector
from gestures.hand_pose import is_pointing
from gestures.static_gestures import StaticGestureFilter
from vision.hand_identity import HandIdentifier

SETTINGS = {
    "pinch": {"start_ratio": 0.25, "end_ratio": 0.35},
    "gestures": {"hold_s": 0.5},
    "two_hand": {"hold_max_spread": 0.05},
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

    def test_peace_sign_fires_once_after_hold_with_progress(self):
        detector = GestureDetector(SETTINGS)
        hand = make_hand(gesture="Victory", score=0.9)
        fired_at, progress = [], []
        for frame in range(40):
            now = frame * 0.05
            states, events = detector.update([hand], now=now)
            progress.append(states[0].pose_hold_progress)
            if PEACE_SIGN in types(events):
                fired_at.append(now)
        self.assertEqual(len(fired_at), 1)
        self.assertAlmostEqual(fired_at[0], 0.6, places=5)
        building = progress[:12]
        self.assertTrue(all(a <= b for a, b in zip(building, building[1:])))  # fills up
        self.assertGreater(max(progress), 0.8)
        self.assertEqual(progress[-1], 0.0)  # cleared after firing

    def test_thumbs_up_fires_once_per_hold_and_rearms_after_lowering(self):
        detector = GestureDetector(SETTINGS)
        fired_at = []
        poses = ["Thumb_Up"] * 30 + ["None"] * 5 + ["Thumb_Up"] * 20
        for frame, pose in enumerate(poses):
            now = frame * 0.05
            _, events = detector.update([make_hand(gesture=pose, score=0.9)], now=now)
            if THUMBS_UP in types(events):
                fired_at.append(now)
        # Stable after 3 frames, held 0.5 s: once in the first hold, once again after lowering the thumb.
        self.assertEqual(len(fired_at), 2)
        self.assertAlmostEqual(fired_at[0], 0.6, places=5)
        self.assertAlmostEqual(fired_at[1], (35 + 2) * 0.05 + 0.5, places=5)

    def test_thumbs_up_released_early_does_not_fire(self):
        detector = GestureDetector(SETTINGS)
        found = []
        for frame in range(8):
            _, events = detector.update([make_hand(gesture="Thumb_Up", score=0.9)], now=frame * 0.05)
            found += types(events)
        for frame in range(8, 30):
            _, events = detector.update([make_hand(gesture="Open_Palm", score=0.9)], now=frame * 0.05)
            found += types(events)
        self.assertNotIn(THUMBS_UP, found)

    def test_switching_pose_restarts_hold(self):
        detector = GestureDetector(SETTINGS)
        found = []
        for frame in range(10):   # thumbs down for 0.45 s, stable after 0.1 s: not yet held 0.5 s
            _, events = detector.update([make_hand(gesture="Thumb_Down", score=0.9)], now=frame * 0.05)
            found += types(events)
        for frame in range(10, 20):
            _, events = detector.update([make_hand(gesture="Victory", score=0.9)], now=frame * 0.05)
            found += types(events)
        self.assertEqual(found, [])

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
