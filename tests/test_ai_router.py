import base64
import unittest

import cv2
import numpy as np

import helpers  # noqa: F401
from ai import contract
from ai.gemini_service import AIResult, AIServiceError
from ai.router import AIRouter, PREVIEW_MAX_SIDE, SNAPSHOT_DELAY_S


def desk_frame(width=1920, height=1080):
    """A grey desk with a bright square in the middle, so crops can be checked."""
    frame = np.full((height, width, 3), 90, dtype=np.uint8)
    frame[height // 4:3 * height // 4, width // 4:3 * width // 4] = 250
    return frame


def decode_data_url(url):
    prefix = "data:image/jpeg;base64,"
    assert url.startswith(prefix), url[:40]
    return cv2.imdecode(np.frombuffer(base64.b64decode(url[len(prefix):]), np.uint8), cv2.IMREAD_COLOR)


class SyncExecutor:
    """Runs submitted work immediately so each test step is deterministic."""

    def submit(self, fn):
        fn()


class HeldExecutor:
    """Keeps submitted work until release(), to test requests that are still running."""

    def __init__(self):
        self.jobs = []

    def submit(self, fn):
        self.jobs.append(fn)

    def release(self):
        while self.jobs:
            self.jobs.pop(0)()


class FakeGemini:
    def __init__(self):
        self.calls = []
        self.fail_with = None

    def configuration_problem(self):
        return None

    def describe(self, image, mime_type="image/jpeg", style="text"):
        self.calls.append(("describe", image, style))
        if self.fail_with:
            raise self.fail_with
        return AIResult(text="A white square on a grey desk.", model="fake", provider="test-double")

    def ask(self, prompt, image=None, mime_type="image/jpeg", context=None, subject=None, grounding=False, style="text"):
        self.calls.append(("ask", prompt, image, grounding, style, len(context or [])))
        if self.fail_with:
            raise self.fail_with
        return AIResult(text="An answer.", model="fake", sources=[{"title": "S", "url": "https://s.example"}],
                        grounded=grounding, provider="test-double")


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.gemini = FakeGemini()
        self.now = 100.0
        self.router = AIRouter(self.gemini, lambda client, message: self.sent.append((client, message)),
                               executor=SyncExecutor(), clock=lambda: self.now)

    def to(self, client, kind=None):
        return [m for c, m in self.sent if c == client and (kind is None or m["type"] == kind)]

    def send(self, client, kind, **fields):
        return self.router.handle(client, {"version": 1, "type": kind, **fields})

    def frame(self, image=None, dt=1 / 30):
        self.now += dt
        self.router.on_frame(desk_frame() if image is None else image, self.now)

    def snapshot(self, client="A", window="window-1", request="snap-1"):
        self.frame()
        self.send(client, contract.AI_SNAPSHOT, window_id=window, request_id=request)
        for _ in range(12):
            self.frame()
        return self.to(client, contract.AI_CAPTURE)[-1]

    # ---- routing ----

    def test_answers_go_only_to_the_asking_window(self):
        self.assertTrue(self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="q1", task="ask", prompt="Hi?"))
        self.send("B", contract.AI_REQUEST, window_id="window-2", request_id="q2", task="ask", prompt="Yo?", style="spoken")
        [a], [b] = self.to("A"), self.to("B")
        self.assertEqual((a["window_id"], a["request_id"], a["ok"], a["text"], a["provider"]),
                         ("window-1", "q1", True, "An answer.", "test-double"))
        self.assertEqual((b["window_id"], b["request_id"]), ("window-2", "q2"))
        self.assertEqual(self.gemini.calls[-1][4], "spoken", "the answer style reaches Gemini")

    def test_other_messages_are_left_for_the_main_loop(self):
        calibration = {"version": 1, "type": "calibration_request", "surface_id": "surface-1", "markers": []}
        self.assertFalse(self.router.handle("A", calibration))
        self.assertFalse(self.router.handle("A", {"type": contract.AI_REQUEST}))
        self.assertFalse(self.router.handle("A", "not a dict"))
        self.assertEqual(self.sent, [])

    def test_invalid_requests_are_answered_with_their_ids(self):
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="q1", task="ask", prompt="")
        self.send("A", contract.AI_CROP, window_id="window-1", request_id="c1", capture_id="capture-1", box={"x": 0.5})
        ask_error, crop_error = self.to("A")
        self.assertEqual((ask_error["type"], ask_error["ok"], ask_error["request_id"], ask_error["error"]["code"]),
                         (contract.AI_RESPONSE, False, "q1", contract.ERR_INVALID))
        self.assertEqual((crop_error["type"], crop_error["ok"], crop_error["request_id"]), (contract.AI_CAPTURE, False, "c1"))
        self.assertEqual(self.gemini.calls, [])

    def test_service_errors_are_returned_not_raised(self):
        self.gemini.fail_with = AIServiceError(contract.ERR_TIMEOUT, "slow")
        self.send("A", contract.AI_REQUEST, window_id="w", request_id="q", task="describe", image={"data": "aGk="})
        [reply] = self.to("A")
        self.assertEqual(reply["error"], {"code": contract.ERR_TIMEOUT, "message": "slow"})

    def test_unknown_photos_are_reported(self):
        self.send("A", contract.AI_REQUEST, window_id="w", request_id="q", task="ask", prompt="?", capture_id="capture-99")
        self.send("A", contract.AI_CROP, window_id="w", request_id="c", capture_id="capture-99",
                  box={"x": 0, "y": 0, "width": 0.5, "height": 0.5})
        self.assertEqual([m["error"]["code"] for m in self.to("A")], [contract.ERR_NOT_FOUND, contract.ERR_NOT_FOUND])

    def test_too_many_running_requests_is_busy(self):
        held = HeldExecutor()
        router = AIRouter(self.gemini, lambda c, m: self.sent.append((c, m)), executor=held, max_pending=2)
        for i in range(3):
            router.handle("A", {"version": 1, "type": contract.AI_REQUEST, "window_id": "w", "request_id": f"q{i}",
                                "task": "ask", "prompt": "?"})
        self.assertEqual([m["request_id"] for c, m in self.sent], ["q2"])
        self.assertEqual(self.sent[0][1]["error"]["code"], contract.ERR_BUSY)
        held.release()
        self.assertEqual(sorted(m["request_id"] for c, m in self.sent if m["ok"]), ["q0", "q1"])

    # ---- snapshots ----

    def test_snapshot_waits_for_a_fresh_frame_after_the_request(self):
        self.frame()
        self.send("A", contract.AI_SNAPSHOT, window_id="window-1", request_id="snap-1")
        self.frame(dt=SNAPSHOT_DELAY_S / 2)
        self.assertEqual(self.to("A"), [], "the projection may still be visible in buffered frames")
        self.frame(dt=SNAPSHOT_DELAY_S)
        [reply] = self.to("A", contract.AI_CAPTURE)
        self.assertEqual((reply["ok"], reply["request_id"], reply["window_id"]), (True, "snap-1", "window-1"))
        self.assertEqual((reply["width"], reply["height"]), (1920, 1080), "the whole camera frame")
        preview = decode_data_url(reply["image"])
        self.assertEqual(max(preview.shape[:2]), PREVIEW_MAX_SIDE, "the browser gets a smaller preview")
        stored = self.router.captures.get(reply["capture_id"])
        self.assertEqual((stored.width, stored.height), (1920, 1080))
        self.frame()
        self.assertEqual(len(self.to("A", contract.AI_CAPTURE)), 1, "one photo per request")

    def test_snapshot_without_camera_frames_fails_fast(self):
        self.send("A", contract.AI_SNAPSHOT, window_id="window-1", request_id="snap-1")
        self.frame()
        self.now += 5
        self.send("A", contract.AI_SNAPSHOT, window_id="window-1", request_id="snap-2")
        replies = self.to("A", contract.AI_CAPTURE)
        self.assertEqual([(m["request_id"], m["ok"], m["error"]["code"]) for m in replies],
                         [("snap-1", False, contract.ERR_NO_FRAME), ("snap-2", False, contract.ERR_NO_FRAME)])

    def test_snapshot_for_a_closed_browser_is_dropped(self):
        self.frame()
        self.send("A", contract.AI_SNAPSHOT, window_id="window-1", request_id="snap-1")
        self.router.client_closed("A")
        for _ in range(12):
            self.frame()
        self.assertEqual(self.to("A"), [])

    def test_no_work_happens_on_frames_without_a_request(self):
        for _ in range(30):
            self.frame()
        self.assertEqual(self.sent, [])

    # ---- crop, describe, and questions about a photo ----

    def test_crop_makes_a_new_photo_of_the_selected_area(self):
        photo = self.snapshot()
        self.send("A", contract.AI_CROP, window_id="window-1", request_id="crop-1", capture_id=photo["capture_id"],
                  box={"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5})
        crop = self.to("A", contract.AI_CAPTURE)[-1]
        self.assertEqual((crop["ok"], crop["request_id"]), (True, "crop-1"))
        self.assertNotEqual(crop["capture_id"], photo["capture_id"])
        self.assertEqual((crop["width"], crop["height"]), (960, 540), "cropped from the full-resolution frame")
        pixels = decode_data_url(crop["image"])
        self.assertGreater(pixels.mean(), 230, "only the bright square was kept")

    def test_describe_and_questions_use_the_stored_photo(self):
        photo = self.snapshot()
        self.send("A", contract.AI_CROP, window_id="window-1", request_id="crop-1", capture_id=photo["capture_id"],
                  box={"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5})
        crop_id = self.to("A", contract.AI_CAPTURE)[-1]["capture_id"]
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="d1", task="describe", capture_id=crop_id, style="spoken")
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="q1", task="ask", prompt="What colour?",
                  capture_id=crop_id, grounding=True, style="spoken", context=[{"role": "model", "text": "A square."}])
        describe_call, ask_call = self.gemini.calls
        stored = self.router.captures.get(crop_id).image
        self.assertEqual((describe_call[0], describe_call[1], describe_call[2]), ("describe", stored, "spoken"))
        self.assertEqual(ask_call, ("ask", "What colour?", stored, True, "spoken", 1))
        described, answered = self.to("A", contract.AI_RESPONSE)
        self.assertEqual((described["task"], described["text"]), ("describe", "A white square on a grey desk."))
        self.assertEqual((answered["request_id"], answered["sources"][0]["url"]), ("q1", "https://s.example"))


if __name__ == "__main__":
    unittest.main()
