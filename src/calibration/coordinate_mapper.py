import numpy as np

from utils.geometry import Point


class CoordinateMapper:
    """Applies an optional horizontal mirror to camera-normalized points.

    These coordinates remain in camera space. The browser shell maps them into projector
    coordinates for each surface with the homography from marker calibration.
    """

    def __init__(self, mirror_x: bool) -> None:
        self._mirror_x = mirror_x

    @classmethod
    def from_settings(cls, settings: dict) -> "CoordinateMapper":
        return cls(mirror_x=settings["surface"]["mirror_x"])

    def to_surface(self, point: Point) -> Point:
        x, y = point
        return (1.0 - x if self._mirror_x else x, y)

    def to_camera(self, point: Point) -> Point:
        # A mirror is its own inverse.
        return self.to_surface(point)

    def matrix(self) -> np.ndarray:
        """to_surface as a 3x3 matrix on homogeneous normalized points."""
        if self._mirror_x:
            return np.array([[-1.0, 0.0, 1.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        return np.eye(3)
