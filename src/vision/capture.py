import cv2
import numpy as np

MAX_SIDE = 1024
JPEG_QUALITY = 85
MIN_CROP_PIXELS = 48


class CaptureError(ValueError):
    pass


def crop_camera_box(frame, box: tuple[float, float, float, float], padding: float = 0.15) -> np.ndarray:
    """Copies a padded camera-normalized box out of a frame, so the frame can be reused afterwards."""
    if frame is None or getattr(frame, "size", 0) == 0:
        raise CaptureError("The camera frame is empty.")
    height, width = frame.shape[:2]
    x, y, w, h = box
    pad_x, pad_y = w * padding, h * padding
    left = int(max(0.0, x - pad_x) * width)
    top = int(max(0.0, y - pad_y) * height)
    right = int(min(1.0, x + w + pad_x) * width)
    bottom = int(min(1.0, y + h + pad_y) * height)
    if right - left < MIN_CROP_PIXELS or bottom - top < MIN_CROP_PIXELS:
        # A tiny box would give the model nothing to see; widen it around its center.
        cx, cy = (left + right) // 2, (top + bottom) // 2
        half = MIN_CROP_PIXELS // 2
        left, right = max(cx - half, 0), min(cx + half, width)
        top, bottom = max(cy - half, 0), min(cy + half, height)
    crop = frame[top:bottom, left:right]
    if crop.size == 0:
        raise CaptureError("The capture area is outside the camera frame.")
    return crop.copy()


def encode_jpeg(image: np.ndarray, max_side: int = MAX_SIDE, quality: int = JPEG_QUALITY) -> bytes:
    """Scales the image so its longest side is at most max_side, then JPEG-encodes it."""
    if image is None or image.size == 0:
        raise CaptureError("The captured image is empty.")
    height, width = image.shape[:2]
    scale = min(1.0, max_side / max(height, width))
    if scale < 1.0:
        image = cv2.resize(image, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise CaptureError("The image could not be encoded.")
    return encoded.tobytes()
