import unittest

import numpy as np

import helpers  # noqa: F401
from ai import contract
from ai.gemini_service import AIResult, AIServiceError
from ai.router import AIRouter
from vision.object_watch import WatchEvent

BOX = (0.4, 0.4, 0.2, 0.2)
FRAME = np.full((240, 320, 3), 120, dtype=np.uint8)


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

    def identify(self, image, mime_type="image/jpeg"):
        self.calls.append(("identify", image[:2]))
        if self.fail_with:
            raise self.fail_with
        return AIResult(text="coffee mug", model="fake", identification={
            "label": "coffee mug", "confidence": "high", "uncertain": False, "object_present": True, "summary": ""})

    def ask(self, prompt, image=None, mime_type="image/jpeg", context=None, subject=None, grounding=False):
        self.calls.append(("ask", prompt, image is not None, subject, grounding, len(context or [])))
        return AIResult(text="An answer.", model="fake", sources=[{"title": "S", "url": "https://s.example"}], grounded=grounding)


class ScriptedWatcher:
    def __init__(self):
        self.pending = []
        self.updates = 0
        self.resets = 0

    def update(self, frame, now, hands=None):
        self.updates += 1
        events, self.pending = self.pending, []
        return events

    def camera_box_for_capture(self, frame):
        return BOX

    def reset(self):
        self.resets += 1


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.gemini = FakeGemini()
        self.watcher = ScriptedWatcher()
        self.now = 100.0
        self.router = AIRouter(self.gemini, lambda client, message: self.sent.append((client, message)),
                               self.watcher, executor=SyncExecutor(), clock=lambda: self.now)

    def to(self, client, kind=None):
        return [m for c, m in self.sent if c == client and (kind is None or m["type"] == kind)]

    def send(self, client, kind, **fields):
        self.router.handle(client, {"version": 1, "type": kind, **fields})

    def frame(self, *events):
        self.watcher.pending = list(events)
        self.router.on_frame(FRAME, [], self.now)

    def watch(self, client="A", window="window-1"):
        self.send(client, contract.EXPLORE_WATCH, window_id=window)

    # ---- routing ----

    def test_response_goes_only_to_the_requesting_window(self):
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="q1", task="ask", prompt="Hi?")
        self.send("B", contract.AI_REQUEST, window_id="window-2", request_id="q2", task="ask", prompt="Yo?")
        [a], [b] = self.to("A"), self.to("B")
        self.assertEqual((a["window_id"], a["request_id"], a["ok"], a["text"]), ("window-1", "q1", True, "An answer."))
        self.assertEqual((b["window_id"], b["request_id"]), ("window-2", "q2"))
        self.assertEqual(a["provider"], "gemini")

    def test_invalid_request_is_answered_with_its_ids(self):
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="q1", task="ask", prompt="")
        [reply] = self.to("A")
        self.assertEqual((reply["ok"], reply["request_id"], reply["error"]["code"]), (False, "q1", contract.ERR_INVALID))
        self.assertEqual(self.gemini.calls, [])

    def test_service_errors_are_returned_not_raised(self):
        self.gemini.fail_with = AIServiceError(contract.ERR_TIMEOUT, "slow")
        self.send("A", contract.AI_REQUEST, window_id="w", request_id="q", task="identify", image={"data": "aGk="})
        [reply] = self.to("A")
        self.assertEqual(reply["error"], {"code": contract.ERR_TIMEOUT, "message": "slow"})

    def test_unknown_capture_is_reported(self):
        self.send("A", contract.AI_REQUEST, window_id="w", request_id="q", task="ask", prompt="?", capture_id="capture-99")
        self.assertEqual(self.to("A")[0]["error"]["code"], contract.ERR_NOT_FOUND)

    def test_too_many_running_requests_is_busy(self):
        held = HeldExecutor()
        router = AIRouter(self.gemini, lambda c, m: self.sent.append((c, m)), self.watcher, executor=held, max_pending=2)
        for i in range(3):
            router.handle("A", {"version": 1, "type": contract.AI_REQUEST, "window_id": "w", "request_id": f"q{i}", "task": "ask", "prompt": "?"})
        self.assertEqual([m["request_id"] for c, m in self.sent], ["q2"])
        self.assertEqual(self.sent[0][1]["error"]["code"], contract.ERR_BUSY)
        held.release()
        self.assertEqual(sorted(m["request_id"] for c, m in self.sent if m["ok"]), ["q0", "q1"])

    # ---- Explore Object consent flow ----

    def test_trigger_captures_and_identifies_without_web_lookup(self):
        self.watch()
        self.assertEqual(self.to("A", contract.EXPLORE_STATUS)[-1]["state"], contract.STATE_WATCHING)
        self.frame(WatchEvent("triggered", BOX))
        [capture] = self.to("A", contract.EXPLORE_CAPTURE)
        self.assertTrue(capture["image"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(capture["trigger"], "auto")
        [identified] = self.to("A", contract.AI_RESPONSE)
        self.assertEqual((identified["request_id"], identified["task"]), (capture["request_id"], "identify"))
        self.assertEqual(identified["identification"]["capture_id"], capture["capture_id"])
        self.assertEqual([c[0] for c in self.gemini.calls], ["identify"], "no lookup before the user says yes")

    def test_yes_asks_with_the_captured_image_and_grounding(self):
        self.watch()
        self.frame(WatchEvent("triggered", BOX))
        capture_id = self.to("A", contract.EXPLORE_CAPTURE)[0]["capture_id"]
        self.send("A", contract.AI_REQUEST, window_id="window-1", request_id="more", task="ask", prompt="Tell me more",
                  capture_id=capture_id, subject="coffee mug", grounding=True)
        self.assertEqual(self.gemini.calls[-1], ("ask", "Tell me more", True, "coffee mug", True, 0))
        reply = self.to("A", contract.AI_RESPONSE)[-1]
        self.assertEqual((reply["request_id"], reply["sources"][0]["url"]), ("more", "https://s.example"))

    def test_no_new_capture_while_a_result_is_shown(self):
        self.watch()
        self.frame(WatchEvent("triggered", BOX))
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual(len(self.to("A", contract.EXPLORE_CAPTURE)), 1)

    def test_no_returns_to_watching_for_a_new_object(self):
        self.watch()
        self.frame(WatchEvent("triggered", BOX))
        self.send("A", contract.EXPLORE_DISMISS, window_id="window-1")
        self.assertEqual(self.to("A", contract.EXPLORE_STATUS)[-1]["state"], contract.STATE_WATCHING)
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual(len(self.to("A", contract.EXPLORE_CAPTURE)), 2)

    def test_object_leaving_is_reported_for_the_shown_capture(self):
        self.watch()
        self.frame(WatchEvent("triggered", BOX))
        capture_id = self.to("A", contract.EXPLORE_CAPTURE)[0]["capture_id"]
        self.frame(WatchEvent("left", BOX))
        [left] = self.to("A", contract.EXPLORE_OBJECT_LEFT)
        self.assertEqual((left["window_id"], left["capture_id"]), ("window-1", capture_id))

    def test_pause_stops_detection_and_resume_relearns(self):
        self.watch()
        self.send("A", contract.EXPLORE_PAUSE, window_id="window-1")
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual((self.watcher.updates, self.to("A", contract.EXPLORE_CAPTURE)), (0, []))
        self.send("A", contract.EXPLORE_RESUME, window_id="window-1")
        self.assertEqual(self.watcher.resets, 1)
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual(len(self.to("A", contract.EXPLORE_CAPTURE)), 1)

    def test_manual_analyze_captures_the_next_frame(self):
        self.watch()
        self.router.on_frame(FRAME, [], self.now)
        self.send("A", contract.EXPLORE_ANALYZE_FRAME, window_id="window-1", request_id="manual-1")
        self.router.on_frame(FRAME, [], self.now)
        [capture] = self.to("A", contract.EXPLORE_CAPTURE)
        self.assertEqual((capture["request_id"], capture["trigger"]), ("manual-1", "manual"))
        self.assertEqual(self.to("A", contract.AI_RESPONSE)[0]["request_id"], "manual-1")

    def test_manual_analyze_without_camera_frames_fails_fast(self):
        self.watch()
        self.send("A", contract.EXPLORE_ANALYZE_FRAME, window_id="window-1", request_id="m")
        self.assertEqual(self.to("A", contract.AI_RESPONSE)[0]["error"]["code"], contract.ERR_NO_FRAME)
        self.router.on_frame(FRAME, [], self.now)
        self.now += 5
        self.send("A", contract.EXPLORE_ANALYZE_FRAME, window_id="window-1", request_id="m2")
        self.assertEqual(self.to("A", contract.AI_RESPONSE)[-1]["error"]["code"], contract.ERR_NO_FRAME, "stale frames")

    def test_second_window_takes_over_and_first_is_told(self):
        self.watch("A", "window-1")
        self.watch("B", "window-2")
        self.assertEqual(self.to("A", contract.EXPLORE_STATUS)[-1]["state"], contract.STATE_INACTIVE)
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual((len(self.to("A", contract.EXPLORE_CAPTURE)), len(self.to("B", contract.EXPLORE_CAPTURE))), (0, 1))
        self.send("A", contract.EXPLORE_PAUSE, window_id="window-1")
        self.assertEqual(self.to("A", contract.EXPLORE_STATUS)[-1]["state"], contract.STATE_INACTIVE)

    def test_no_detection_work_without_an_open_window(self):
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual(self.watcher.updates, 0)
        self.watch()
        self.router.client_closed("A")
        self.frame(WatchEvent("triggered", BOX))
        self.assertEqual((self.watcher.updates, self.to("A", contract.EXPLORE_CAPTURE)), (0, []))

    def test_messages_of_other_types_are_ignored(self):
        self.send("A", "pointer_move", x=0.5, y=0.5)
        self.router.handle("A", {"type": contract.AI_REQUEST})
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
