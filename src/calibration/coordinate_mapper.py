from utils.geometry import Point


class CoordinateMapper:
    """Converts camera-normalized points into canvas-normalized points and back.

    Canvas coordinates are 0-1 across the full projected canvas, as the integration
    contract requires. Until calibration exists this is only an optional horizontal
    mirror; calibration will replace it with a homography without changing any callers.
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