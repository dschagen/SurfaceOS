import time


def monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


class FpsCounter:
    """Exponentially smoothed frames-per-second estimate for debug display."""

    def __init__(self, smoothing: float = 0.9) -> None:
        self._smoothing = smoothing
        self._last_time: float | None = None
        self.fps = 0.0

    def tick(self) -> float:
        now = time.perf_counter()
        if self._last_time is not None and now > self._last_time:
            instant = 1.0 / (now - self._last_time)
            if self.fps == 0.0:
                self.fps = instant
            else:
                self.fps = self._smoothing * self.fps + (1 - self._smoothing) * instant
        self._last_time = now
        return self.fps