"""Detects a distinct object placed in a designated camera area, using local image differences only.

The area is compared with a learned picture of it while empty. An object counts once the difference
covers enough of the area, no hand is inside it, and it has stayed still for `stable_s`. Each trigger
is followed by a cooldown, and a small image hash of recent triggers stops the same stationary object
from being submitted again when it is briefly covered or lifted and put back.

All coordinates are camera-normalized (0-1 across the camera frame), not canvas coordinates.
"""

from dataclasses import dataclass

import cv2
import numpy as np

EMPTY = "empty"
CANDIDATE = "candidate"
PRESENT = "present"

ANALYSIS_WIDTH = 160


@dataclass
class WatchSettings:
    roi: tuple[float, float, float, float] = (0.25, 0.25, 0.5, 0.5)
    diff_threshold: int = 30          # grey levels that count as changed
    enter_fraction: float = 0.03      # share of the area that must change to start a candidate
    leave_fraction: float = 0.12      # share of the object's box still changed below which it has left
    motion_fraction: float = 0.01     # frame-to-frame change allowed while "still"
    stable_s: float = 0.8
    leave_s: float = 0.7
    cooldown_s: float = 4.0
    dedup_window_s: float = 30.0
    dedup_distance: int = 10          # of 64 hash bits
    warmup_frames: int = 8
    background_rate: float = 0.05
    hand_padding: float = 0.06

    @classmethod
    def from_settings(cls, explore: dict) -> "WatchSettings":
        values = {key: explore[key] for key in cls.__dataclass_fields__ if key in explore}
        if "roi" in values:
            values["roi"] = tuple(float(v) for v in values["roi"])
        return cls(**values)


@dataclass
class WatchEvent:
    type: str                                   # "triggered" or "left"
    box: tuple[float, float, float, float]      # camera-normalized x, y, width, height


def average_hash(gray: np.ndarray) -> int:
    small = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA).astype(np.float32)
    bits = (small > small.mean()).flatten()
    return int(sum(1 << i for i, bit in enumerate(bits) if bit))


def hash_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


@dataclass
class Signature:
    """What the same object looks like again: pattern, brightness, and size in the analysis image."""
    pattern: int
    brightness: float
    width: int
    height: int

    def matches(self, other: "Signature", max_distance: int) -> bool:
        def similar(a, b):
            return min(a, b) / max(a, b, 1) >= 0.7
        return (hash_distance(self.pattern, other.pattern) <= max_distance
                and abs(self.brightness - other.brightness) <= 20
                and similar(self.width, other.width) and similar(self.height, other.height))


def hand_boxes(hands, padding: float) -> list[tuple[float, float, float, float]]:
    """Padded camera-normalized boxes around each tracked hand's landmarks."""
    boxes = []
    for hand in hands:
        xs = [x for x, _ in hand.normalized_landmarks]
        ys = [y for _, y in hand.normalized_landmarks]
        boxes.append((min(xs) - padding, min(ys) - padding, max(xs) - min(xs) + 2 * padding, max(ys) - min(ys) + 2 * padding))
    return boxes


class ObjectWatcher:
    def __init__(self, settings: WatchSettings | None = None) -> None:
        self.settings = settings or WatchSettings()
        self.reset()
        self._recent: list[tuple[float, Signature]] = []
        self._last_trigger = -1e9

    def reset(self) -> None:
        """Forgets the learned empty area; it is relearned from the next frames."""
        self.state = EMPTY
        self._background: np.ndarray | None = None
        self._previous: np.ndarray | None = None
        self._warmup = 0
        self._since: float | None = None
        # The area as it looked when the current stillness began, to catch slow drift.
        self._anchor: np.ndarray | None = None
        self._present_box: tuple[int, int, int, int] | None = None
        self._left_since: float | None = None

    # ---- geometry ----

    def _roi_pixels(self, frame) -> tuple[int, int, int, int]:
        height, width = frame.shape[:2]
        x, y, w, h = self.settings.roi
        left, top = int(max(0.0, x) * width), int(max(0.0, y) * height)
        right, bottom = int(min(1.0, x + w) * width), int(min(1.0, y + h) * height)
        return left, top, max(right - left, 1), max(bottom - top, 1)

    def _small(self, frame) -> np.ndarray:
        left, top, w, h = self._roi_pixels(frame)
        crop = frame[top:top + h, left:left + w]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
        size = (ANALYSIS_WIDTH, max(1, round(ANALYSIS_WIDTH * h / w)))
        return cv2.GaussianBlur(cv2.resize(gray, size, interpolation=cv2.INTER_AREA), (5, 5), 0)

    def _hand_mask(self, shape, boxes) -> np.ndarray:
        mask = np.zeros(shape, dtype=bool)
        rx, ry, rw, rh = self.settings.roi
        rows, cols = shape
        for bx, by, bw, bh in boxes:
            x0 = int(np.floor((bx - rx) / rw * cols))
            y0 = int(np.floor((by - ry) / rh * rows))
            x1 = int(np.ceil((bx + bw - rx) / rw * cols))
            y1 = int(np.ceil((by + bh - ry) / rh * rows))
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, cols), min(y1, rows)
            if x1 > x0 and y1 > y0:
                mask[y0:y1, x0:x1] = True
        return mask

    def _to_camera_box(self, box, shape) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = box
        rows, cols = shape
        rx, ry, rw, rh = self.settings.roi
        return (rx + x0 / cols * rw, ry + y0 / rows * rh, (x1 - x0) / cols * rw, (y1 - y0) / rows * rh)

    @staticmethod
    def _bounding_box(mask: np.ndarray) -> tuple[int, int, int, int] | None:
        # Opening removes speckle noise so the box follows the object rather than stray pixels.
        cleaned = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        ys, xs = np.nonzero(cleaned)
        if len(xs) == 0:
            return None
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

    # ---- public ----

    def camera_box_for_capture(self, frame) -> tuple[float, float, float, float]:
        """Box around the present object, or the whole watched area when none is known."""
        if self._present_box is not None and self._background is not None:
            return self._to_camera_box(self._present_box, self._background.shape)
        return self.settings.roi

    def update(self, frame, now: float, hands_in_frame: list | None = None) -> list[WatchEvent]:
        """Processes one camera frame and returns any events. Cheap enough for every frame."""
        s = self.settings
        small = self._small(frame)
        if self._background is None or self._background.shape != small.shape:
            self._background = small.astype(np.float32)
            self._previous = small
            self._warmup = 1
            return []
        if self._warmup < s.warmup_frames:
            cv2.accumulateWeighted(small.astype(np.float32), self._background, 0.3)
            self._previous = small
            self._warmup += 1
            return []

        hands = self._hand_mask(small.shape, hand_boxes(hands_in_frame or [], s.hand_padding))
        hand_inside = bool(hands.any())
        changed = (np.abs(small.astype(np.float32) - self._background) > s.diff_threshold) & ~hands
        moving = (np.abs(small.astype(np.int16) - self._previous.astype(np.int16)) > s.diff_threshold) & ~hands
        self._previous = small
        area = changed.size
        still = moving.sum() / area < s.motion_fraction and not hand_inside
        events: list[WatchEvent] = []

        if self.state == PRESENT:
            x0, y0, x1, y1 = self._present_box
            box_area = max((x1 - x0) * (y1 - y0), 1)
            remaining = changed[y0:y1, x0:x1].sum() / box_area
            if remaining < s.leave_fraction and not hand_inside:
                self._left_since = self._left_since if self._left_since is not None else now
                if now - self._left_since >= s.leave_s:
                    events.append(WatchEvent("left", self._to_camera_box(self._present_box, small.shape)))
                    self.state = EMPTY
                    self._present_box = None
                    self._left_since = None
                    self._since = None
                    self._anchor = None
            else:
                self._left_since = None
            if self.state == PRESENT:
                # A second object elsewhere in the area becomes a new candidate.
                outside = changed.copy()
                pad = 4
                outside[max(y0 - pad, 0):y1 + pad, max(x0 - pad, 0):x1 + pad] = False
                if outside.sum() / area >= s.enter_fraction:
                    events.extend(self._consider(outside, small, now, still))
            return events

        fraction = changed.sum() / area
        if self.state == EMPTY:
            if fraction >= s.enter_fraction and not hand_inside:
                self.state = CANDIDATE
                self._since = None
                self._anchor = None
            elif fraction < s.enter_fraction / 3 and not hand_inside:
                # Follow slow lighting changes while nothing is there.
                cv2.accumulateWeighted(small.astype(np.float32), self._background, s.background_rate)
            return events

        # CANDIDATE
        if fraction < s.enter_fraction / 2 and not hand_inside:
            self.state = EMPTY
            self._since = None
            self._anchor = None
            return events
        return self._consider(changed, small, now, still)

    def _consider(self, changed, small, now: float, still: bool) -> list[WatchEvent]:
        s = self.settings
        if still and self._anchor is not None:
            drift = (np.abs(small.astype(np.int16) - self._anchor.astype(np.int16)) > s.diff_threshold).mean()
            still = drift < s.motion_fraction * 2
        if not still:
            self._since = None
            self._anchor = None
            return []
        if self._since is None:
            self._since = now
            self._anchor = small
        if now - self._since < s.stable_s or now - self._last_trigger < s.cooldown_s:
            return []
        box = self._bounding_box(changed)
        if box is None:
            return []
        x0, y0, x1, y1 = box
        region = small[y0:y1, x0:x1]
        signature = Signature(average_hash(region), float(region.mean()), x1 - x0, y1 - y0)
        self._recent = [(t, sig) for t, sig in self._recent if now - t < s.dedup_window_s]
        self._since = None
        self._anchor = None
        if self._present_box is not None:
            px0, py0, px1, py1 = self._present_box
            box = (min(x0, px0), min(y0, py0), max(x1, px1), max(y1, py1))
        self._present_box = box
        self.state = PRESENT
        if any(signature.matches(previous, s.dedup_distance) for _, previous in self._recent):
            return []
        self._recent.append((now, signature))
        self._last_trigger = now
        return [WatchEvent("triggered", self._to_camera_box((x0, y0, x1, y1), small.shape))]
