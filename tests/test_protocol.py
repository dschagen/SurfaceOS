import unittest

import helpers  # noqa: F401
from input.events import POINTER_CANCEL, POINTER_MOVE, Pointer, SurfaceInputEvent
from server.protocol import PrimaryPointer, encode, primary_messages


def pointer(hand_id, is_down=False):
    return Pointer(id=hand_id, x=0.5, y=0.5, is_down=is_down, gesture="None")


class ProtocolTests(unittest.TestCase):
    def test_encode_matches_contract_and_clamps(self):
        message = encode(SurfaceInputEvent(POINTER_MOVE, 3, 1.2, -0.1))
        self.assertEqual(message, {"version": 1, "type": "pointer_move",
                                   "x": 1.0, "y": 0.0, "source": "hand"})

    def test_only_primary_hand_is_sent(self):
        primary = PrimaryPointer()
        primary.select([pointer(0), pointer(1)])
        events = [SurfaceInputEvent(POINTER_MOVE, 0, 0.1, 0.1),
                  SurfaceInputEvent(POINTER_MOVE, 1, 0.9, 0.9)]
        messages = primary_messages(events, primary, [pointer(0), pointer(1)])
        self.assertEqual([m["x"] for m in messages], [0.1])

    def test_lost_primary_still_sends_cancel_then_hands_over(self):
        primary = PrimaryPointer()
        primary.select([pointer(0), pointer(1)])
        messages = primary_messages([SurfaceInputEvent(POINTER_CANCEL, 0, 0.5, 0.5)],
                                    primary, [pointer(1)])
        self.assertEqual([m["type"] for m in messages], [POINTER_CANCEL])
        self.assertEqual(primary.hand_id, 1)

    def test_pressed_hand_is_not_chosen_as_replacement(self):
        primary = PrimaryPointer()
        primary.select([pointer(1, is_down=True)])
        self.assertIsNone(primary.hand_id)


if __name__ == "__main__":
    unittest.main()
