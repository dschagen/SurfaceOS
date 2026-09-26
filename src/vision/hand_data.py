from dataclasses import dataclass

WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
MIDDLE_KNUCKLE = 9

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
    """One detected hand in a single frame, before any gesture interpretation."""

    pixel_points: list[tuple[int, int]]
    # Normalized 0-1 screen-space position, already mirrored if MIRROR_X is on.
    index_tip: tuple[float, float]
    pinch_ratio: float
    gesture: str
    handedness: str
