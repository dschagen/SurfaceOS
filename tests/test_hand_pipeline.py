import unittest

from helpers import make_hand
from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import GestureDetector
from input.interaction_state import InteractionState
from server.protocol import PrimaryPointer, hands_debug_message, primary_messages
from test_gestures import OPEN, PINCHED, SETTINGS


class HandPipelineTests(unittest.TestCase):
    """The messages the browser receives, from hand data through encoding."""

    def setUp(self):
        self.gestures = GestureDetector(SETTINGS)
        self.interaction = InteractionState(0.0, SETTINGS)
        self.mapper = CoordinateMapper(mirror_x=False)
        self.primary = PrimaryPointer()
        self.now = 0.0

    def frame(self, hands):
        self.now += 1.0  # longer than the hold time, so a pinch presses on its second frame
        states, gesture_events = self.gestures.update(hands, now=self.now)
        pointers, events = self.interaction.update(hands, states, gesture_events, self.mapper, now=self.now)
        sending = self.primary.hand_id
        messages = primary_messages(events, self.primary, pointers)
        return messages, hands_debug_message(pointers, sending)

    def test_pinch_hold_move_release_and_loss(self):
        self.frame([make_hand(tip=(0.4, 0.5), pinch_ratio=OPEN)])  # first frame chooses the primary hand
        sent = []
        sent += self.frame([make_hand(tip=(0.4, 0.5), pinch_ratio=PINCHED)])[0]
        for x in (0.41, 0.42, 0.43):
            sent += self.frame([make_hand(tip=(x, 0.5), pinch_ratio=PINCHED)])[0]
        sent += self.frame([make_hand(tip=(0.43, 0.5), pinch_ratio=OPEN)])[0]
        presses = [m["type"] for m in sent if m["type"] not in ("pointer_move", "hold_progress")]
        self.assertEqual(presses, ["pointer_down", "pointer_up"])  # held movement never repeats the press
        self.assertEqual(sum(m["type"] == "pointer_move" for m in sent), 5)

        # A pinch lost before its hold time never pressed; the loss still cancels.
        sent = self.frame([make_hand(tip=(0.43, 0.5), pinch_ratio=PINCHED)])[0]
        sent += self.frame([])[0]
        self.assertEqual([m["type"] for m in sent if m["type"] != "hold_progress"],
                         ["pointer_move", "pointer_cancel"])

    def test_bubbles_match_pointer_positions_and_state(self):
        self.frame([make_hand(0, tip=(0.2, 0.3)), make_hand(1, tip=(0.8, 0.6))])
        messages, debug = self.frame([make_hand(0, tip=(0.2, 0.3), pinch_ratio=PINCHED),
                                      make_hand(1, tip=(0.8, 0.6))])
        move = next(m for m in messages if m["type"] == "pointer_move")
        by_id = {hand["id"]: hand for hand in debug["hands"]}
        self.assertEqual(debug["type"], "hand_debug")
        self.assertEqual((by_id[0]["x"], by_id[0]["y"]), (move["x"], move["y"]))
        self.assertTrue(by_id[0]["primary"] and by_id[0]["pinching"])
        self.assertFalse(by_id[1]["primary"] or by_id[1]["pinching"])
        self.assertEqual((by_id[1]["x"], by_id[1]["y"]), (0.8, 0.6))

    def test_lost_hands_leave_the_snapshot(self):
        self.frame([make_hand(0), make_hand(1, tip=(0.9, 0.9))])
        _, debug = self.frame([make_hand(0)])
        self.assertEqual([hand["id"] for hand in debug["hands"]], [0])
        _, debug = self.frame([])
        self.assertEqual(debug["hands"], [])


if __name__ == "__main__":
    unittest.main()
