import cv2

import config
from capture.snipper import save_snip
from gestures.gesture_detector import GestureDetector, TrackedHand
from gestures.snip_gesture import SnipGesture
from server.server import StateServer
from vision.hand_data import HAND_CONNECTIONS, INDEX_TIP
from vision.hand_tracker import HandTracker


def draw_preview(frame, hands: list[TrackedHand], snipping: bool) -> None:
    for hand in hands:
        points = hand.source.pixel_points
        for start, end in HAND_CONNECTIONS:
            cv2.line(frame, points[start], points[end], (200, 200, 200), 2)
        tip_color = (0, 255, 0) if hand.pinch else (0, 0, 255)
        cv2.circle(frame, points[INDEX_TIP], 12, tip_color, -1)

    gestures = ", ".join(hand.gesture for hand in hands) or "none"
    status = f"hands={len(hands)} snipping={snipping} gestures={gestures}"
    cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)


def main() -> None:
    tracker = HandTracker()
    detector = GestureDetector()
    snip = SnipGesture()
    server = StateServer()
    server.start()

    snip_count = 0
    last_snip = ""

    print("SurfaceOS running.")
    print("  One hand: point to move, pinch to press.")
    print("  Two hands: pinch both, spread apart, release to snip.")
    print(f"  Snips are saved to {config.SNIP_DIR}")
    print("Press Q in the preview window (or Ctrl + C here) to quit.")

    try:
        while True:
            frame, raw_hands = tracker.read()
            if frame is None:
                print("ERROR: Could not read frame")
                break

            clean_frame = frame.copy()
            hands = detector.update(raw_hands)

            capture_rect = snip.update(hands)
            if capture_rect is not None:
                path = save_snip(capture_rect, clean_frame)
                snip_count += 1
                last_snip = path.name
                print(f"Saved {path}")

            server.update({
                "hands": [hand.to_dict() for hand in hands],
                "snip": snip.rect_dict(),
                "capturing": snip.capturing,
                "snip_count": snip_count,
                "last_snip": last_snip,
            })

            if config.SHOW_PREVIEW:
                draw_preview(frame, hands, snip.active)
                cv2.imshow("SurfaceOS Tracker", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    except KeyboardInterrupt:
        pass
    finally:
        tracker.close()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
