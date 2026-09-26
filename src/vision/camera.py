import cv2


class Camera:
    """Thin wrapper around an OpenCV capture device."""

    def __init__(self, index: int, width: int | None = None, height: int | None = None) -> None:
        self._capture = cv2.VideoCapture(index)
        if not self._capture.isOpened():
            raise RuntimeError(f"Could not open camera {index}")
        if width and height:
            self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    @property
    def resolution(self) -> tuple[int, int]:
        return (int(self._capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
                int(self._capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))

    def read(self):
        """Returns the next frame, or None if the camera stopped delivering images."""
        success, frame = self._capture.read()
        return frame if success else None

    def release(self) -> None:
        self._capture.release()