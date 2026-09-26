from utils.geometry import Point, distance


class HandIdentifier:
    """Gives each hand an id that stays the same from frame to frame.

    MediaPipe does not track hands across frames and its left/right labels flicker,
    so each new wrist position is matched to the nearest wrist from the previous frame.
    """

    def __init__(self, match_distance: float) -> None:
        self._match_distance = match_distance
        self._previous: dict[int, Point] = {}
        self._next_id = 0

    def assign(self, wrists: list[Point]) -> list[int]:
        available = dict(self._previous)
        ids = []
        for wrist in wrists:
            best_id = None
            best_distance = self._match_distance
            for hand_id, previous_wrist in available.items():
                gap = distance(wrist, previous_wrist)
                if gap < best_distance:
                    best_id, best_distance = hand_id, gap

            if best_id is None:
                best_id = self._next_id
                self._next_id += 1
            else:
                del available[best_id]
            ids.append(best_id)

        self._previous = dict(zip(ids, wrists))
        return ids