NO_GESTURE = "None"


class StaticGestureFilter:
    """Reports a pretrained static gesture only after it has been seen consistently.

    MediaPipe's per-frame labels flicker between poses, which would otherwise fire
    spurious events.
    """

    def __init__(self, min_score: float, stable_frames: int) -> None:
        self._min_score = min_score
        self._stable_frames = stable_frames
        self._candidate = NO_GESTURE
        self._candidate_frames = 0
        self.stable = NO_GESTURE

    def update(self, label: str, score: float) -> str | None:
        """Returns the new stable label on the frame it changes, otherwise None."""
        if score < self._min_score:
            label = NO_GESTURE

        if label == self._candidate:
            self._candidate_frames += 1
        else:
            self._candidate = label
            self._candidate_frames = 1

        if self._candidate_frames >= self._stable_frames and label != self.stable:
            self.stable = label
            return label
        return None