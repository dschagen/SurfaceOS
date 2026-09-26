from utils.geometry import distance
from vision.hand_data import HandData

WRIST = 0
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_PIP, MIDDLE_TIP = 10, 12
RING_PIP, RING_TIP = 14, 16
PINKY_PIP, PINKY_TIP = 18, 20

# How close the index finger's joints must be to a straight line: 1.0 is perfectly straight.
STRAIGHT_RATIO = 0.9


def _is_straight(points, mcp: int, pip: int, dip: int, tip: int) -> bool:
    """A finger is straight when its knuckle-to-tip distance nearly equals the sum of its bones."""
    bones = distance(points[mcp], points[pip]) + distance(points[pip], points[dip]) \
        + distance(points[dip], points[tip])
    if bones == 0:
        return False
    return distance(points[mcp], points[tip]) / bones >= STRAIGHT_RATIO


def _is_curled(points, pip: int, tip: int) -> bool:
    """A finger is curled when its tip is closer to the wrist than its middle joint."""
    return distance(points[WRIST], points[tip]) < distance(points[WRIST], points[pip])


def is_pointing(hand: HandData) -> bool:
    """Pointing pose: index finger straight and extended, middle, ring and pinky curled."""
    points = hand.pixel_landmarks
    index_extended = distance(points[WRIST], points[INDEX_TIP]) > distance(points[WRIST], points[INDEX_PIP])
    return (
        index_extended
        and _is_straight(points, INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP)
        and _is_curled(points, MIDDLE_PIP, MIDDLE_TIP)
        and _is_curled(points, RING_PIP, RING_TIP)
        and _is_curled(points, PINKY_PIP, PINKY_TIP)
    )