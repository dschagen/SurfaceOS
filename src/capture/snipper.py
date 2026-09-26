import time
from pathlib import Path

import cv2
import mss
import mss.tools

import config

Rect = tuple[float, float, float, float]


def _snip_path() -> Path:
    config.SNIP_DIR.mkdir(exist_ok=True)
    return config.SNIP_DIR / f"snip_{time.strftime('%Y%m%d_%H%M%S')}.png"


def capture_screen(rect: Rect) -> Path:
    x1, y1, x2, y2 = rect
    with mss.mss() as screen:
        monitor = screen.monitors[config.SNIP_MONITOR]
        region = {
            "left": monitor["left"] + int(x1 * monitor["width"]),
            "top": monitor["top"] + int(y1 * monitor["height"]),
            "width": max(1, int((x2 - x1) * monitor["width"])),
            "height": max(1, int((y2 - y1) * monitor["height"])),
        }
        shot = screen.grab(region)
        path = _snip_path()
        mss.tools.to_png(shot.rgb, shot.size, output=str(path))
    return path


def capture_camera(frame, rect: Rect) -> Path:
    x1, y1, x2, y2 = rect
    # The rectangle is in mirrored screen space; convert back to raw camera columns.
    if config.MIRROR_X:
        x1, x2 = 1.0 - x2, 1.0 - x1
    height, width = frame.shape[:2]
    crop = frame[int(y1 * height):int(y2 * height), int(x1 * width):int(x2 * width)]
    path = _snip_path()
    cv2.imwrite(str(path), crop)
    return path


def save_snip(rect: Rect, frame) -> Path:
    if config.SNIP_SOURCE == "camera":
        return capture_camera(frame, rect)
    return capture_screen(rect)
