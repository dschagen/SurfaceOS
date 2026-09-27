import unittest

import cv2
import numpy as np

import helpers  # noqa: F401
from vision.capture import CaptureError, crop_normalized, decode_jpeg, encode_jpeg


class CaptureTests(unittest.TestCase):
    def test_crop_uses_normalized_box(self):
        image = np.zeros((200, 400, 3), dtype=np.uint8)
        image[50:150, 100:300] = 255
        crop = crop_normalized(image, (0.25, 0.25, 0.5, 0.5))
        self.assertEqual(crop.shape[:2], (100, 200))
        self.assertTrue((crop == 255).all())

    def test_tiny_crop_is_widened(self):
        crop = crop_normalized(np.zeros((480, 640, 3), dtype=np.uint8), (0.5, 0.5, 0.001, 0.001))
        self.assertGreaterEqual(min(crop.shape[:2]), 40)

    def test_encoding_limits_the_longest_side_and_round_trips(self):
        big = np.zeros((3000, 4000, 3), dtype=np.uint8)
        decoded = decode_jpeg(encode_jpeg(big))
        self.assertEqual(max(decoded.shape[:2]), 1024)
        wide = decode_jpeg(encode_jpeg(big, max_side=1920))
        self.assertEqual(max(wide.shape[:2]), 1920)

    def test_empty_images_are_rejected(self):
        with self.assertRaises(CaptureError):
            crop_normalized(None, (0, 0, 1, 1))
        with self.assertRaises(CaptureError):
            encode_jpeg(np.zeros((0, 0, 3), dtype=np.uint8))
        with self.assertRaises(CaptureError):
            decode_jpeg(b"not an image")


if __name__ == "__main__":
    unittest.main()
