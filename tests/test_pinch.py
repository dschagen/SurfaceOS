import unittest

from helpers import make_hand
from gestures.pinch_detector import PinchDetector, pinch_ratio


class PinchTests(unittest.TestCase):
    def test_ratio_is_scaled_by_hand_size(self):
        self.assertAlmostEqual(pinch_ratio(make_hand(pinch_ratio=0.5)), 0.5, places=1)

    def test_hysteresis(self):
        detector = PinchDetector(start_ratio=0.25, end_ratio=0.35)
        self.assertFalse(detector.update(0.30).is_pinching)  # between thresholds, not yet started
        self.assertTrue(detector.update(0.20).is_pinching)
        self.assertTrue(detector.update(0.30).is_pinching)   # between thresholds, stays pinched
        self.assertFalse(detector.update(0.40).is_pinching)

    def test_strength_range(self):
        detector = PinchDetector(0.25, 0.35)
        self.assertEqual(detector.update(0.1).strength, 1.0)
        self.assertEqual(detector.update(2.0).strength, 0.0)

    def test_invalid_thresholds(self):
        with self.assertRaises(ValueError):
            PinchDetector(0.4, 0.3)


if __name__ == "__main__":
    unittest.main()
