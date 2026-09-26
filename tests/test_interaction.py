import unittest

from helpers import make_hand
from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import GestureDetector
from input.events import DOUBLE_PINCH, POINTER_CANCEL, POINTER_DOWN, POINTER_MOVE, POINTER_UP
from input.interaction_state import InteractionState
from test_gestures import OPEN, PINCHED, SETTINGS


def types(events):
    return [event.type for event in events]


class InteractionTests(unittest.TestCase):
    def setUp(self):
        self.gestures = GestureDetector(SETTINGS)
        self.interaction = InteractionState(smoothing=0.0)
        self.mapper = CoordinateMapper(mirror_x=True)
        self.now = 0.0

    def step(self, hands, dt=0.1):
        self.now += dt
        states, gesture_events = self.gestures.update(hands, now=self.now)
        return self.interaction.update(hands, states, gesture_events, self.mapper)

    def test_every_frame_moves(self):
        _, events = self.step([make_hand(tip=(0.3, 0.4))])
        self.assertEqual(types(events), [POINTER_MOVE])
        self.assertAlmostEqual(events[0].x, 0.7)  # mirrored into canvas space

    def test_pinch_is_one_down_then_one_up(self):
        _, events = self.step([make_hand(pinch_ratio=PINCHED)])
        self.assertEqual(types(events), [POINTER_MOVE, POINTER_DOWN])
        _, events = self.step([make_hand(pinch_ratio=PINCHED)])
        self.assertEqual(types(events), [POINTER_MOVE])  # holding: movement only, no repeat press
        _, events = self.step([make_hand(pinch_ratio=OPEN)])
        self.assertEqual(types(events), [POINTER_MOVE, POINTER_UP])

    def test_double_pinch_comes_before_its_pointer_down(self):
        self.step([make_hand(pinch_ratio=PINCHED)])
        self.step([make_hand(pinch_ratio=OPEN)])
        _, events = self.step([make_hand(pinch_ratio=PINCHED)])
        self.assertEqual(types(events), [POINTER_MOVE, DOUBLE_PINCH, POINTER_DOWN])

    def test_lost_hand_cancels(self):
        self.step([make_hand(pinch_ratio=PINCHED)])
        pointers, events = self.step([])
        self.assertEqual(pointers, [])
        self.assertEqual(types(events), [POINTER_CANCEL])


if __name__ == "__main__":
    unittest.main()
