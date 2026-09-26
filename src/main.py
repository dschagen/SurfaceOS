import time

import cv2

from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import GestureDetector
from input.events import POINTER_MOVE, SCROLL, TWO_HAND_PINCH_MOVE
from input.interaction_state import InteractionState
from server.protocol import PrimaryPointer, hands_debug_message, primary_messages
from server.server import SurfaceServer
from settings import MODEL_PATH, load_settings
from utils.timing import FpsCounter
from vision.camera import Camera
from vision.hand_tracker import HandTracker
from vision.preview import draw_preview


def main() -> None:
    settings = load_settings()

    camera = Camera(settings["camera"]["index"], settings["camera"]["width"],
                    settings["camera"]["height"])
    tracker = HandTracker(MODEL_PATH, settings["tracking"]["max_hands"],
                          settings["tracking"]["identity_match_distance"])
    gestures = GestureDetector(settings)
    mapper = CoordinateMapper.from_settings(settings)
    interaction = InteractionState(settings["pointer"]["smoothing"], settings)
    primary = PrimaryPointer()
    server = SurfaceServer(settings["server"]["host"], settings["server"]["port"])
    server.start()

    fps = FpsCounter()
    show_preview = settings["debug"]["show_preview"]
    # Sends every tracked hand to the browser's debug bubbles; turn off for the demo.
    send_hand_bubbles = settings["debug"].get("hand_bubbles", False)

    print("SurfaceOS hand input running.")
    print("Press Q in the preview window (or Ctrl + C here) to quit.")

    try:
        while True:
            frame = camera.read()
            if frame is None:
                print("ERROR: Could not read frame")
                break

            now = time.monotonic()
            hands = tracker.process(frame)
            states, gesture_events = gestures.update(hands, now)
            pointers, input_events = interaction.update(hands, states, gesture_events, mapper, now)

            # The hand whose events are sent this frame; primary_messages may hand over afterwards.
            sending_hand = primary.hand_id
            for message in primary_messages(input_events, primary, pointers):
                server.publish(message)
                # Moves and scrolls arrive every frame, so only discrete events are printed.
                if message["type"] not in (POINTER_MOVE, SCROLL, TWO_HAND_PINCH_MOVE):
                    details = " ".join(f"{key}={value}" for key, value in message.items()
                                       if key not in ("version", "type", "source"))
                    print(f"{message['type']} {details}")
            if send_hand_bubbles:
                server.publish(hands_debug_message(pointers, sending_hand))

            fps.tick()
            if show_preview:
                pinching = {hand_id for hand_id, state in states.items() if state.is_pinching}
                status = f"{fps.fps:4.1f} fps  hands={len(hands)}  primary={primary.hand_id}"
                ratios = {hand_id: state.pinch_ratio for hand_id, state in states.items()}
                draw_preview(frame, hands, pinching, primary.hand_id, status, ratios)
                cv2.imshow("SurfaceOS Hand Input", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    except KeyboardInterrupt:
        pass
    finally:
        tracker.close()
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
