from dataclasses import dataclass

from utils.geometry import Point

WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
MIDDLE_KNUCKLE = 9
MIDDLE_TIP = 12
RING_TIP = 16
PINKY_TIP = 20

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


@dataclass
class HandData:
    """One detected hand in one frame, in camera space. Carries no gesture interpretation."""

    hand_id: int
    handedness: str
    confidence: float
    # Camera-normalized 0-1 coordinates, exactly as MediaPipe reports them (not mirrored).
    normalized_landmarks: list[Point]
    pixel_landmarks: list[tuple[int, int]]
    # Raw label and score from MediaPipe's pretrained gesture model.
    static_gesture: str = "None"
    static_gesture_score: float = 0.0

    @property
    def index_tip(self) -> Point:
        return self.normalized_landmarks[INDEX_TIP]

    @property
    def thumb_tip(self) -> Point:
        return self.normalized_landmarks[THUMB_TIP]

    @property
    def wrist(self) -> Point:
        return self.normalized_landmarks[WRIST]