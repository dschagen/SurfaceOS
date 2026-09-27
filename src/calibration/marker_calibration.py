"""Camera-to-surface calibration from ArUco markers that the browser shell projects.

The shell draws a marker grid inside one calibrated surface and sends a calibration_request
listing each marker's corners in surface-local 0-1 coordinates. The tracker finds the markers
in the camera image, fits a homography from surface-local points to the same camera coordinates
that pointer events carry, and answers with a calibration_result.
"""

import math

import cv2
import numpy as np

from calibration.coordinate_mapper import CoordinateMapper

PROTOCOL_VERSION = 1
CALIBRATION_REQUEST = "calibration_request"
CALIBRATION_RESULT = "calibration_result"
DICTIONARY = cv2.aruco.DICT_4X4_50
MAX_MARKER_ID = 49

# Frames captured right after a request can still show the previous projection.
SETTLE_S = 0.3
# Detections are collected for this long and combined per marker corner.
COLLECT_S = 1.5
MIN_MARKERS = 4
MIN_INLIERS = 12
RANSAC_PX = 3.0
# Median reprojection error, in camera pixels, above which a calibration is rejected.
MAX_ERROR_PX = 4.0
# Found markers must span at least this fraction of the requested grid in both directions.
MIN_COVERAGE = 0.5


def parse_request(message) -> dict | None:
    """Returns {"surface_id", "markers": {id: 4x2 array}} for a valid request, otherwise None."""
    if not isinstance(message, dict) or message.get("version") != PROTOCOL_VERSION:
        return None
    if message.get("type") != CALIBRATION_REQUEST:
        return None
    surface_id = message.get("surface_id")
    markers = message.get("markers")
    if not isinstance(surface_id, str) or not surface_id or not isinstance(markers, list) or not markers:
        return None
    parsed: dict[int, np.ndarray] = {}
    for marker in markers:
        if not isinstance(marker, dict):
            return None
        marker_id = marker.get("id")
        corners = marker.get("corners")
        if not isinstance(marker_id, int) or isinstance(marker_id, bool) or not 0 <= marker_id <= MAX_MARKER_ID:
            return None
        if marker_id in parsed or not isinstance(corners, list) or len(corners) != 4:
            return None
        points = []
        for corner in corners:
            if not isinstance(corner, list) or len(corner) != 2:
                return None
            if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                       and math.isfinite(value) for value in corner):
                return None
            points.append((float(corner[0]), float(corner[1])))
        parsed[marker_id] = np.array(points, dtype=np.float64)
    return {"surface_id": surface_id, "markers": parsed}


class MarkerDetector:
    """Finds DICT_4X4_50 markers and returns their corners in camera pixels."""

    def __init__(self) -> None:
        parameters = cv2.aruco.DetectorParameters()
        parameters.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICTIONARY), parameters)

    def detect(self, frame) -> dict[int, np.ndarray]:
        gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, _ = self._detector.detectMarkers(gray)
        if ids is None:
            return {}
        return {int(marker_id): corner.reshape(4, 2).astype(np.float64)
                for marker_id, corner in zip(ids.ravel(), corners)}


def solve(expected: dict[int, np.ndarray], observed: dict[int, np.ndarray],
          frame_size: tuple[int, int], mapper: CoordinateMapper) -> dict:
    """Fits surface-local points to camera pixels and reports the fit as a result message body.

    The returned homography maps surface-local (u, v) to the normalized, optionally mirrored
    camera coordinates of pointer events, as nine row-major values with the last equal to 1.
    """
    ids = sorted(set(expected) & set(observed))
    base = {"markers_found": len(ids), "markers_expected": len(expected)}
    if len(ids) < MIN_MARKERS:
        return {**base, "ok": False,
                "reason": f"The camera found {len(ids)} of {len(expected)} markers. "
                          "Check that it sees the whole surface and that nothing blocks the projection."}

    centers = np.array([expected[i].mean(axis=0) for i in ids])
    all_centers = np.array([corners.mean(axis=0) for corners in expected.values()])
    span = np.ptp(all_centers, axis=0)
    covered = np.ptp(centers, axis=0)
    if any(total > 0 and found / total < MIN_COVERAGE for found, total in zip(covered, span)):
        return {**base, "ok": False,
                "reason": "The camera sees only part of this surface. Move or aim the camera to cover all of it."}

    source = np.concatenate([expected[i] for i in ids])
    target = np.concatenate([observed[i] for i in ids])
    homography, mask = cv2.findHomography(source, target, cv2.RANSAC, RANSAC_PX)
    if homography is None or mask is None or int(mask.sum()) < MIN_INLIERS:
        return {**base, "ok": False,
                "reason": "The marker positions do not fit one flat surface. Check that the surface is flat and try again."}

    inliers = mask.ravel().astype(bool)
    projected = cv2.perspectiveTransform(source.reshape(-1, 1, 2), homography).reshape(-1, 2)
    error_px = float(np.median(np.linalg.norm(projected - target, axis=1)[inliers]))
    if error_px > MAX_ERROR_PX:
        return {**base, "ok": False, "error_px": round(error_px, 2),
                "reason": f"The fit error is {error_px:.1f} camera pixels. Hold the camera still, "
                          "check focus, and make sure the surface is flat."}

    width, height = frame_size
    normalize = np.array([[1 / width, 0, 0], [0, 1 / height, 0], [0, 0, 1]])
    camera = mapper.matrix() @ normalize @ homography
    camera /= camera[2, 2]
    return {**base, "ok": True, "error_px": round(error_px, 2),
            "camera": [round(float(value), 10) for value in camera.ravel()]}


class MarkerCalibration:
    """Collects detections for one request over several frames, then solves once."""

    def __init__(self, mapper: CoordinateMapper, detector: MarkerDetector | None = None) -> None:
        self._mapper = mapper
        self._detector = detector or MarkerDetector()
        self._request: dict | None = None
        self._started = 0.0
        self._frames = 0
        self._seen: dict[int, list[np.ndarray]] = {}
        self._last: dict[int, np.ndarray] = {}

    @property
    def active(self) -> bool:
        return self._request is not None

    def start(self, request: dict, now: float) -> None:
        """Begins a new request. Any request still in progress is replaced."""
        self._request = request
        self._started = now
        self._frames = 0
        self._seen = {}
        self._last = {}

    def update(self, frame, now: float) -> dict | None:
        """Feeds one camera frame. Returns the calibration_result message when finished."""
        if self._request is None or now < self._started + SETTLE_S:
            return None
        self._last = self._detector.detect(frame)
        self._frames += 1
        for marker_id, corners in self._last.items():
            if marker_id in self._request["markers"]:
                self._seen.setdefault(marker_id, []).append(corners)
        if now < self._started + SETTLE_S + COLLECT_S:
            return None

        # A marker must appear in at least half the frames; each corner is the median position.
        needed = max(1, self._frames // 2)
        observed = {marker_id: np.median(np.stack(samples), axis=0)
                    for marker_id, samples in self._seen.items() if len(samples) >= needed}
        height, width = frame.shape[:2]
        result = solve(self._request["markers"], observed, (width, height), self._mapper)
        surface_id = self._request["surface_id"]
        self._request = None
        return {"version": PROTOCOL_VERSION, "type": CALIBRATION_RESULT, "surface_id": surface_id, **result}

    def draw(self, frame) -> None:
        """Outlines the markers found in the latest frame on the preview image."""
        if self._request is None or not self._last:
            return
        ids = np.array(list(self._last), dtype=np.int32).reshape(-1, 1)
        corners = [corners.reshape(1, 4, 2).astype(np.float32) for corners in self._last.values()]
        cv2.aruco.drawDetectedMarkers(frame, corners, ids)
