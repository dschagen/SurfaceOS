import time

import cv2

from calibration.coordinate_mapper import CoordinateMapper
from calibration.marker_calibration import MarkerCalibration, parse_request
from gestures.gesture_detector import GestureDetector
from input.events import HOLD_PROGRESS, POINTER_MOVE, SCROLL, TWO_HAND_PINCH_MOVE
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
                    settings["camera"]["height"], settings["camera"].get("fps"))
    # The camera may not support the requested mode; report what it actually delivers.
    width, height = camera.resolution
    print(f"Camera {settings['camera']['index']} opened at {width}x{height}, {camera.fps:.0f} fps")
    tracker = HandTracker(MODEL_PATH, settings["tracking"]["max_hands"],
                          settings["tracking"]["identity_match_distance"])
    gestures = GestureDetector(settings)
    mapper = CoordinateMapper.from_settings(settings)
    calibration = MarkerCalibration(mapper)
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
            for message in server.poll():
                request = parse_request(message)
                if request is None:
                    print(f"Ignoring browser message: {str(message)[:120]}")
                    continue
                calibration.start(request, now)
                print(f"Calibrating {request['surface_id']} from {len(request['markers'])} projected markers")
            result = calibration.update(frame, now)
            if result is not None:
                server.publish(result)
                print(f"calibration_result {result['surface_id']} ok={result['ok']} "
                      f"markers={result['markers_found']}/{result['markers_expected']} "
                      f"error_px={result.get('error_px')} {result.get('reason', '')}".rstrip())

            hands = tracker.process(frame)
            states, gesture_events = gestures.update(hands, now)
            pointers, input_events = interaction.update(hands, states, gesture_events, mapper, now)

            # The hand whose events are sent this frame; primary_messages may hand over afterwards.
            sending_hand = primary.hand_id
            for message in primary_messages(input_events, primary, pointers):
                server.publish(message)
                # Moves, scrolls and hold progress arrive every frame, so only discrete events are printed.
                if message["type"] not in (POINTER_MOVE, SCROLL, TWO_HAND_PINCH_MOVE, HOLD_PROGRESS):
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
                calibration.draw(frame)
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
