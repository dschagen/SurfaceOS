import cv2

from calibration.coordinate_mapper import CoordinateMapper
from gestures.gesture_detector import GestureDetector
from input.events import POINTER_MOVE
from input.interaction_state import InteractionState
from server.protocol import PrimaryPointer, primary_messages
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
    interaction = InteractionState(settings["pointer"]["smoothing"])
    primary = PrimaryPointer()
    server = SurfaceServer(settings["server"]["host"], settings["server"]["port"])
    server.start()

    fps = FpsCounter()
    show_preview = settings["debug"]["show_preview"]

    print("SurfaceOS hand input running.")
    print("Press Q in the preview window (or Ctrl + C here) to quit.")

    try:
        while True:
            frame = camera.read()
            if frame is None:
                print("ERROR: Could not read frame")
                break

            hands = tracker.process(frame)
            states, gesture_events = gestures.update(hands)
            pointers, input_events = interaction.update(hands, states, gesture_events, mapper)

            for message in primary_messages(input_events, primary, pointers):
                server.publish(message)
                if message["type"] != POINTER_MOVE:
                    print(f"{message['type']} x={message['x']:.2f} y={message['y']:.2f}")

            fps.tick()
            if show_preview:
                pinching = {hand_id for hand_id, state in states.items() if state.is_pinching}
                status = f"{fps.fps:4.1f} fps  hands={len(hands)}  primary={primary.hand_id}"
                draw_preview(frame, hands, pinching, primary.hand_id, status)
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