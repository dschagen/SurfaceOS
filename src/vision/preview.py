import cv2

from vision.hand_data import HAND_CONNECTIONS, INDEX_TIP, HandData


def draw_preview(frame, hands: list[HandData], pinching_ids: set[int],
                 primary_id: int | None, status: str,
                 pinch_ratios: dict[int, float] | None = None) -> None:
    """Draws landmarks and a status line onto the camera frame for debugging.

    With pinch_ratios, each hand also shows its live pinch ratio for tuning the thresholds
    in config/settings.json: lower means the thumb and index finger are closer together.
    """
    for hand in hands:
        points = hand.pixel_landmarks
        for start, end in HAND_CONNECTIONS:
            cv2.line(frame, points[start], points[end], (200, 200, 200), 2)
        tip_color = (0, 255, 0) if hand.hand_id in pinching_ids else (0, 0, 255)
        cv2.circle(frame, points[INDEX_TIP], 12, tip_color, -1)
        if hand.hand_id == primary_id:
            # The ring marks the hand that drives the pointer sent to the browser.
            cv2.circle(frame, points[INDEX_TIP], 20, (255, 255, 0), 2)
        label = f"id {hand.hand_id}"
        if pinch_ratios is not None and hand.hand_id in pinch_ratios:
            label += f"  pinch {pinch_ratios[hand.hand_id]:.2f}"
        cv2.putText(frame, label, (points[0][0] + 10, points[0][1]),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    cv2.putText(frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)