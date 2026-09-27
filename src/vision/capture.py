import cv2
import numpy as np

MAX_SIDE = 1024
JPEG_QUALITY = 85
MIN_CROP_PIXELS = 48


class CaptureError(ValueError):
    pass


def crop_normalized(image, box: tuple[float, float, float, float], padding: float = 0.0) -> np.ndarray:
    """Copies a normalized (x, y, width, height) box out of an image, so the image can be reused."""
    if image is None or getattr(image, "size", 0) == 0:
        raise CaptureError("The image is empty.")
    height, width = image.shape[:2]
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
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        raise CaptureError("The selected area is outside the image.")
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


def decode_jpeg(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR) if data else None
    if image is None:
        raise CaptureError("The stored image could not be read.")
    return image
