import unittest
from types import SimpleNamespace

import numpy as np

import helpers  # noqa: F401
from vision.capture import CaptureError, crop_camera_box, encode_jpeg
from vision.object_watch import CANDIDATE, EMPTY, PRESENT, ObjectWatcher, WatchSettings

WIDTH, HEIGHT = 320, 240
FRAME_S = 1 / 30


def frame(*objects):
    """A plain grey desk with dark rectangles at camera-normalized (x, y, w, h, shade)."""
    image = np.full((HEIGHT, WIDTH, 3), 120, dtype=np.uint8)
    for x, y, w, h, shade in objects:
        image[int(y * HEIGHT):int((y + h) * HEIGHT), int(x * WIDTH):int((x + w) * WIDTH)] = shade
    return image


def hand_at(x, y):
    return SimpleNamespace(normalized_landmarks=[(x, y), (x + 0.06, y + 0.08)])


MUG = (0.40, 0.40, 0.15, 0.18, 30)
BOOK = (0.28, 0.30, 0.10, 0.12, 220)


class WatcherHarness:
    def __init__(self, **overrides):
        self.watcher = ObjectWatcher(WatchSettings(**{"cooldown_s": 2.0, "dedup_window_s": 20.0, **overrides}))
        self.now = 0.0

    def run(self, image, seconds, hands=None):
        events = []
        for _ in range(int(round(seconds / FRAME_S))):
            self.now += FRAME_S
            events.extend(self.watcher.update(image, self.now, hands))
        return [event.type for event in events]


class ObjectWatchTests(unittest.TestCase):
    def setUp(self):
        self.h = WatcherHarness()
        self.h.run(frame(), 1.0)  # learn the empty area

    def test_empty_area_never_triggers(self):
        self.assertEqual(self.h.run(frame(), 5.0), [])
        self.assertEqual(self.h.watcher.state, EMPTY)

    def test_object_triggers_once_after_staying_still(self):
        self.assertEqual(self.h.run(frame(MUG), 0.5), [], "not yet stable")
        self.assertEqual(self.h.watcher.state, CANDIDATE)
        self.assertEqual(self.h.run(frame(MUG), 0.5), ["triggered"])
        self.assertEqual(self.h.run(frame(MUG), 10.0), [], "a stationary object is submitted only once")
        self.assertEqual(self.h.watcher.state, PRESENT)

    def test_trigger_box_surrounds_the_object(self):
        self.h.run(frame(MUG), 0.5)
        self.h.now += FRAME_S
        events = []
        for _ in range(30):
            self.h.now += FRAME_S
            events += self.h.watcher.update(frame(MUG), self.h.now)
        x, y, w, h = events[0].box
        self.assertAlmostEqual(x, MUG[0], delta=0.03)
        self.assertAlmostEqual(y, MUG[1], delta=0.03)
        self.assertAlmostEqual(w, MUG[2], delta=0.04)
        self.assertAlmostEqual(h, MUG[3], delta=0.04)

    def test_moving_object_waits_until_still(self):
        events = []
        for step in range(40):  # slides across the area for about 1.3 s
            events += self.h.run(frame((0.30 + step * 0.008, 0.40, 0.12, 0.12, 30)), FRAME_S)
        self.assertEqual(events, [])
        self.assertEqual(self.h.run(frame((0.62, 0.40, 0.12, 0.12, 30)), 1.0), ["triggered"])

    def test_hand_in_area_blocks_trigger(self):
        self.assertEqual(self.h.run(frame(MUG), 2.0, hands=[hand_at(0.42, 0.42)]), [])
        self.assertEqual(self.h.run(frame(MUG), 1.0), ["triggered"], "triggers once the hand is gone")

    def test_hand_outside_area_does_not_block(self):
        self.assertEqual(self.h.run(frame(MUG), 1.0, hands=[hand_at(0.02, 0.02)]), ["triggered"])

    def test_object_leaving_is_reported(self):
        self.h.run(frame(MUG), 1.0)
        self.assertEqual(self.h.run(frame(), 1.0), ["left"])
        self.assertEqual(self.h.watcher.state, EMPTY)

    def test_same_object_put_back_is_deduplicated(self):
        self.h.run(frame(MUG), 1.0)
        self.h.run(frame(), 1.0)
        self.assertEqual(self.h.run(frame(MUG), 3.0), [], "same object within the dedup window")
        self.assertEqual(self.h.watcher.state, PRESENT)

    def test_same_object_after_dedup_window_triggers_again(self):
        self.h.run(frame(MUG), 1.0)
        self.h.run(frame(), 1.0)
        self.h.now += 25.0
        self.assertEqual(self.h.run(frame(MUG), 1.0), ["triggered"])

    def test_different_object_waits_for_cooldown(self):
        self.h.run(frame(MUG), 1.0)
        self.h.run(frame(), 0.8)
        self.h.now += 1.0
        self.assertEqual(self.h.run(frame(BOOK), 1.0), ["triggered"], "different object after the 2 s cooldown")

    def test_cooldown_holds_back_a_quick_second_object(self):
        h = WatcherHarness(cooldown_s=10.0)
        h.run(frame(), 1.0)
        h.run(frame(MUG), 1.0)
        h.run(frame(), 1.0)
        self.assertEqual(h.run(frame(BOOK), 3.0), [], "inside the cooldown")
        self.assertEqual(h.run(frame(BOOK), 6.0), ["triggered"])

    def test_second_object_next_to_a_present_one_triggers(self):
        self.h.run(frame(MUG), 1.0)
        self.h.now += 3.0
        self.assertEqual(self.h.run(frame(MUG, (0.62, 0.30, 0.1, 0.1, 220)), 1.0), ["triggered"])

    def test_slow_lighting_change_is_absorbed(self):
        for shade in range(120, 135):
            self.assertEqual(self.h.run(np.full((HEIGHT, WIDTH, 3), shade, dtype=np.uint8), 0.3), [])


class CaptureTests(unittest.TestCase):
    def test_crop_is_padded_and_encoded_small(self):
        image = frame(MUG)
        crop = crop_camera_box(image, MUG[:4])
        self.assertGreater(crop.shape[1], MUG[2] * WIDTH)
        big = np.zeros((3000, 4000, 3), dtype=np.uint8)
        import cv2
        decoded = cv2.imdecode(np.frombuffer(encode_jpeg(big), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(max(decoded.shape[:2]), 1024)

    def test_empty_frames_are_rejected(self):
        with self.assertRaises(CaptureError):
            crop_camera_box(None, (0, 0, 1, 1))
        with self.assertRaises(CaptureError):
            encode_jpeg(np.zeros((0, 0, 3), dtype=np.uint8))


if __name__ == "__main__":
    unittest.main()
