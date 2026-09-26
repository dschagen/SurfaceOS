import unittest

import helpers  # noqa: F401
from input.events import (POINTER_CANCEL, POINTER_MOVE, SCROLL, THUMBS_DOWN, TWO_HAND_PINCH_CANCEL,
                          TWO_HAND_PINCH_MOVE, Pointer, SurfaceInputEvent)
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


class NewEventProtocolTests(unittest.TestCase):
    def test_two_hand_rectangle_fields(self):
        message = encode(SurfaceInputEvent(TWO_HAND_PINCH_MOVE, None, 0.2, 0.3, width=0.4, height=0.5))
        self.assertEqual(message, {"version": 1, "type": "two_hand_pinch_move", "x": 0.2, "y": 0.3,
                                   "width": 0.4, "height": 0.5, "source": "hand"})

    def test_cancel_has_no_position(self):
        message = encode(SurfaceInputEvent(TWO_HAND_PINCH_CANCEL, None))
        self.assertEqual(message, {"version": 1, "type": "two_hand_pinch_cancel", "source": "hand"})

    def test_scroll_keeps_sign_of_dy(self):
        message = encode(SurfaceInputEvent(SCROLL, 0, 0.5, 0.5, dy=-0.03))
        self.assertEqual(message["dy"], -0.03)

    def test_gestures_from_any_hand_are_sent(self):
        primary = PrimaryPointer()
        primary.select([pointer(0), pointer(1)])
        events = [SurfaceInputEvent(THUMBS_DOWN, 1, 0.8, 0.8),
                  SurfaceInputEvent(TWO_HAND_PINCH_CANCEL, None),
                  SurfaceInputEvent(SCROLL, 1, 0.8, 0.8, dy=0.1)]
        messages = primary_messages(events, primary, [pointer(0), pointer(1)])
        self.assertEqual([m["type"] for m in messages], ["thumbs_down", "two_hand_pinch_cancel"])


if __name__ == "__main__":
    unittest.main()
