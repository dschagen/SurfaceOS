import re
import unittest
from pathlib import Path

import cv2
import numpy as np

import helpers  # noqa: F401
from calibration.coordinate_mapper import CoordinateMapper
from calibration.marker_calibration import (CALIBRATION_RESULT, COLLECT_S, DICTIONARY, SETTLE_S,
                                            MarkerCalibration, parse_request)

MARKERS_JS = Path(__file__).resolve().parent.parent / "surfaceos-shell" / "frontend" / "scripts" / "markers.js"
PLANE = (1600, 900)                 # unwarped surface plane in pixels, as the shell lays it out
CAMERA = (1280, 720)
# Where the plane's corners land in the camera image: a tilted, off-center view.
CAMERA_CORNERS = np.float32([[210, 130], [1090, 95], [1170, 640], [160, 590]])


def js_patterns() -> list[str]:
    return re.findall(r"'([01]{16})'", MARKERS_JS.read_text(encoding="utf-8"))


def layout(width: int, height: int, columns: int = 4, rows: int = 3, fill: float = 0.6) -> list[dict]:
    """Same grid as markerLayout in markers.js."""
    cell_w, cell_h = width / columns, height / rows
    side = fill * min(cell_w, cell_h)
    markers = []
    for row in range(rows):
        for column in range(columns):
            cx, cy = (column + 0.5) * cell_w, (row + 0.5) * cell_h
            x0, x1 = (cx - side / 2) / width, (cx + side / 2) / width
            y0, y1 = (cy - side / 2) / height, (cy + side / 2) / height
            markers.append({"id": row * columns + column, "corners": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]})
    return markers


def plane_image(markers: list[dict], skip: set[int] = frozenset()) -> np.ndarray:
    """Draws the markers the way drawMarkers in markers.js does, using its bit table."""
    width, height = PLANE
    image = np.full((height, width), 255, np.uint8)
    patterns = js_patterns()
    for marker in markers:
        if marker["id"] in skip:
            continue
        (x0, y0), _, (x1, y1), _ = marker["corners"]
        xs = [round((x0 + (x1 - x0) * i / 6) * width) for i in range(7)]
        ys = [round((y0 + (y1 - y0) * i / 6) * height) for i in range(7)]
        image[ys[0]:ys[6], xs[0]:xs[6]] = 0
        for r in range(4):
            for c in range(4):
                if patterns[marker["id"]][r * 4 + c] == "1":
                    image[ys[r + 1]:ys[r + 2], xs[c + 1]:xs[c + 2]] = 255
    return image


def plane_to_camera() -> np.ndarray:
    width, height = PLANE
    return cv2.getPerspectiveTransform(np.float32([[0, 0], [width, 0], [width, height], [0, height]]),
                                       CAMERA_CORNERS)


def camera_frame(markers: list[dict], skip: set[int] = frozenset()) -> np.ndarray:
    warped = cv2.warpPerspective(plane_image(markers, skip), plane_to_camera(), CAMERA, borderValue=20)
    return cv2.cvtColor(cv2.GaussianBlur(warped, (3, 3), 0), cv2.COLOR_GRAY2BGR)


def expected_camera_point(u: float, v: float, mirror: bool = False) -> tuple[float, float]:
    width, height = PLANE
    point = cv2.perspectiveTransform(np.float64([[[u * width, v * height]]]), plane_to_camera())[0, 0]
    x, y = point[0] / CAMERA[0], point[1] / CAMERA[1]
    return (1 - x if mirror else x, y)


def apply(h: list[float], u: float, v: float) -> tuple[float, float]:
    d = h[6] * u + h[7] * v + h[8]
    return ((h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d)


def run_calibration(frame: np.ndarray, markers: list[dict], mirror: bool = False) -> dict | None:
    calibration = MarkerCalibration(CoordinateMapper(mirror))
    request = parse_request({"version": 1, "type": "calibration_request", "surface_id": "surface-1",
                             "markers": markers})
    calibration.start(request, 0.0)
    result = None
    for now in np.arange(0.0, SETTLE_S + COLLECT_S + 0.2, 0.1):
        result = calibration.update(frame, float(now)) or result
    return result


class MarkerPatternTests(unittest.TestCase):
    def test_browser_patterns_match_opencv(self):
        dictionary = cv2.aruco.getPredefinedDictionary(DICTIONARY)
        patterns = js_patterns()
        self.assertEqual(len(patterns), 12)
        for marker_id, pattern in enumerate(patterns):
            image = cv2.aruco.generateImageMarker(dictionary, marker_id, 6)
            bits = "".join("1" if image[r, c] > 127 else "0" for r in range(1, 5) for c in range(1, 5))
            self.assertEqual(pattern, bits, f"marker {marker_id}")


class MarkerCalibrationTests(unittest.TestCase):
    def test_recovers_surface_to_camera_mapping(self):
        markers = layout(*PLANE)
        result = run_calibration(camera_frame(markers), markers)
        self.assertEqual(result["type"], CALIBRATION_RESULT)
        self.assertEqual(result["surface_id"], "surface-1")
        self.assertTrue(result["ok"], result.get("reason"))
        self.assertEqual(result["markers_found"], 12)
        self.assertLess(result["error_px"], 1.0)
        for u, v in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.5, 0.5), (0.3, 0.8)]:
            x, y = apply(result["camera"], u, v)
            ex, ey = expected_camera_point(u, v)
            self.assertAlmostEqual(x, ex, delta=0.003)
            self.assertAlmostEqual(y, ey, delta=0.003)

    def test_mirrored_tracker_gets_mirrored_mapping(self):
        markers = layout(*PLANE)
        result = run_calibration(camera_frame(markers), markers, mirror=True)
        self.assertTrue(result["ok"])
        x, y = apply(result["camera"], 0.2, 0.3)
        ex, ey = expected_camera_point(0.2, 0.3, mirror=True)
        self.assertAlmostEqual(x, ex, delta=0.003)
        self.assertAlmostEqual(y, ey, delta=0.003)

    def test_too_few_markers_fails_with_reason(self):
        markers = layout(*PLANE)
        result = run_calibration(camera_frame(markers, skip=set(range(2, 12))), markers)
        self.assertFalse(result["ok"])
        self.assertEqual(result["markers_found"], 2)
        self.assertIn("2 of 12", result["reason"])
        self.assertNotIn("camera", result)

    def test_markers_on_one_side_only_fails(self):
        markers = layout(*PLANE)
        # Only the two left columns are visible: enough markers, but a third of the width.
        result = run_calibration(camera_frame(markers, skip={2, 3, 6, 7, 10, 11}), markers)
        self.assertFalse(result["ok"])
        self.assertIn("part of this surface", result["reason"])

    def test_blank_frame_fails(self):
        markers = layout(*PLANE)
        result = run_calibration(np.zeros((CAMERA[1], CAMERA[0], 3), np.uint8), markers)
        self.assertFalse(result["ok"])
        self.assertEqual(result["markers_found"], 0)

    def test_frames_before_settle_are_ignored(self):
        markers = layout(*PLANE)
        calibration = MarkerCalibration(CoordinateMapper(False))
        calibration.start(parse_request({"version": 1, "type": "calibration_request",
                                         "surface_id": "s", "markers": markers}), 10.0)
        self.assertIsNone(calibration.update(camera_frame(markers), 10.0 + SETTLE_S / 2))
        self.assertTrue(calibration.active)
        self.assertIsNotNone(calibration.update(camera_frame(markers), 10.0 + SETTLE_S + COLLECT_S))
        self.assertFalse(calibration.active)


class ParseRequestTests(unittest.TestCase):
    def valid(self) -> dict:
        return {"version": 1, "type": "calibration_request", "surface_id": "surface-1",
                "markers": [{"id": 0, "corners": [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]]}]}

    def test_valid_request(self):
        request = parse_request(self.valid())
        self.assertEqual(request["surface_id"], "surface-1")
        self.assertEqual(request["markers"][0].shape, (4, 2))

    def test_rejects_malformed_requests(self):
        bad = [None, [], {"version": 2}, {**self.valid(), "type": "pointer_move"},
               {**self.valid(), "surface_id": ""}, {**self.valid(), "markers": []},
               {**self.valid(), "markers": [{"id": 99, "corners": self.valid()["markers"][0]["corners"]}]},
               {**self.valid(), "markers": [{"id": True, "corners": self.valid()["markers"][0]["corners"]}]},
               {**self.valid(), "markers": [{"id": 0, "corners": [[0, 0]] * 3}]},
               {**self.valid(), "markers": [{"id": 0, "corners": [[0, 0], [1, 0], [1, 1], [0, float("nan")]]}]},
               {**self.valid(), "markers": self.valid()["markers"] * 2}]
        for message in bad:
            self.assertIsNone(parse_request(message), message)


class MapperMatrixTests(unittest.TestCase):
    def test_matrix_matches_to_surface(self):
        for mirror in (False, True):
            mapper = CoordinateMapper(mirror)
            x, y, w = mapper.matrix() @ np.array([0.3, 0.6, 1.0])
            self.assertEqual((x / w, y / w), mapper.to_surface((0.3, 0.6)))


if __name__ == "__main__":
    unittest.main()
