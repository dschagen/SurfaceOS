"""Routes AI and Explore Object messages between browser windows, the camera loop, and Gemini.

Three threads meet here: the WebSocket thread calls handle(), the camera loop calls on_frame(),
and worker threads run Gemini calls and image encoding. Shared state sits behind one lock, and
replies go only to the connection and window that asked.
"""

import base64
import itertools
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

from ai import contract
from ai.gemini_service import AIServiceError, GeminiService
from vision.capture import CaptureError, crop_camera_box, encode_jpeg
from vision.object_watch import ObjectWatcher

# A manual capture needs a camera frame at most this old.
FRAME_MAX_AGE_S = 2.0


class CaptureStore:
    """Recent captured images by id, so follow-up questions reuse an image without resending it."""

    def __init__(self, limit: int = 20) -> None:
        self._items: OrderedDict[str, bytes] = OrderedDict()
        self._limit = limit
        self._counter = itertools.count(1)
        self._lock = threading.Lock()

    def add(self, image: bytes) -> str:
        with self._lock:
            capture_id = f"capture-{next(self._counter)}"
            self._items[capture_id] = image
            while len(self._items) > self._limit:
                self._items.popitem(last=False)
            return capture_id

    def get(self, capture_id: str) -> bytes | None:
        with self._lock:
            return self._items.get(capture_id)


class AIRouter:
    def __init__(self, gemini: GeminiService, send, watcher: ObjectWatcher | None = None,
                 executor=None, max_pending: int = 4, clock=time.monotonic) -> None:
        """send(client_id, message) must be safe to call from any thread."""
        self.gemini = gemini
        self._send = send
        self.watcher = watcher or ObjectWatcher()
        self._executor = executor or ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai")
        self._max_pending = max_pending
        self._clock = clock
        self.captures = CaptureStore()
        self._lock = threading.Lock()
        self._pending = 0
        self._auto_ids = itertools.count(1)
        # Explore Object: one window at a time owns the camera area.
        self._owner: tuple[object, str] | None = None
        self._paused = False
        self._holding = False
        self._held_capture: str | None = None
        self._manual: tuple[object, str, str] | None = None
        self._last_frame_at: float | None = None

    # ---- messages from browsers (WebSocket thread) ----

    def handle(self, client_id, message) -> bool:
        """Handles AI and Explore messages and returns True; returns False for any other message."""
        if not isinstance(message, dict) or message.get("version") != contract.VERSION:
            return False
        kind = message.get("type")
        if kind != contract.AI_REQUEST and kind not in contract.EXPLORE_REQUESTS:
            return False
        try:
            if kind == contract.AI_REQUEST:
                self._handle_ai_request(client_id, contract.parse_ai_request(message))
            elif kind in contract.EXPLORE_REQUESTS:
                self._handle_explore(client_id, kind, message)
        except contract.ContractError as error:
            window_id = message.get("window_id") if isinstance(message.get("window_id"), str) else None
            request_id = message.get("request_id") if isinstance(message.get("request_id"), str) else None
            print(f"Rejected {kind}: {error}")
            self._send(client_id, contract.ai_error(window_id, request_id, error.code, str(error)))
        return True

    def client_closed(self, client_id) -> None:
        with self._lock:
            if self._owner and self._owner[0] == client_id:
                self._owner = None
                self._manual = None

    def _handle_ai_request(self, client_id, request: contract.AIRequest) -> None:
        image = request.image_bytes
        if image is None and request.capture_id is not None:
            image = self.captures.get(request.capture_id)
            if image is None:
                self._send(client_id, contract.ai_error(request.window_id, request.request_id, contract.ERR_NOT_FOUND,
                                                        "That captured image is no longer available. Capture it again.", request.task))
                return
        if request.task == "identify":
            job = lambda: self.gemini.identify(image, request.image_mime)  # noqa: E731
        else:
            job = lambda: self.gemini.ask(request.prompt, image=image, mime_type=request.image_mime,  # noqa: E731
                                          context=request.context, subject=request.subject, grounding=request.grounding)
        extra = {"capture_id": request.capture_id} if request.capture_id else {}
        self._submit(client_id, request.window_id, request.request_id, request.task, job, extra)

    def _submit(self, client_id, window_id: str, request_id: str, task: str, job, extra: dict | None = None) -> None:
        with self._lock:
            if self._pending >= self._max_pending:
                busy = True
            else:
                busy = False
                self._pending += 1
        if busy:
            self._send(client_id, contract.ai_error(window_id, request_id, contract.ERR_BUSY,
                                                    "Too many AI requests are running. Try again in a moment.", task))
            return

        def run():
            try:
                result = job()
                reply = contract.ai_response(window_id, request_id, task, {**result.to_message_fields(), **(extra or {})})
            except AIServiceError as error:
                reply = contract.ai_error(window_id, request_id, error.code, error.message, task)
            except Exception as error:  # noqa: BLE001 - a worker must always answer
                print(f"AI request {request_id} failed: {error!r}")
                reply = contract.ai_error(window_id, request_id, contract.ERR_API, "The AI request failed unexpectedly.", task)
            finally:
                with self._lock:
                    self._pending -= 1
            self._send(client_id, reply)

        self._executor.submit(run)

    def _handle_explore(self, client_id, kind: str, message: dict) -> None:
        window_id = contract.window_id_of(message)
        if kind == contract.EXPLORE_WATCH:
            with self._lock:
                previous = self._owner
                self._owner = (client_id, window_id)
                self._paused = False
                self._holding = False
                self._held_capture = None
            if previous and previous != (client_id, window_id):
                self._send(previous[0], contract.explore_status(previous[1], contract.STATE_INACTIVE,
                                                                "Another Explore Object window is using the camera area."))
            self._status(client_id, window_id, contract.STATE_WATCHING)
            return

        with self._lock:
            owns = self._owner == (client_id, window_id)
        if not owns:
            if kind == contract.EXPLORE_ANALYZE_FRAME:
                request_id = contract.request_id_of(message)
                self._send(client_id, contract.ai_error(window_id, request_id, contract.ERR_INVALID,
                                                        "This window is not watching the camera area.", "identify"))
            elif kind != contract.EXPLORE_RELEASE:
                self._send(client_id, contract.explore_status(window_id, contract.STATE_INACTIVE,
                                                              "Another Explore Object window is using the camera area."))
            return

        if kind == contract.EXPLORE_RELEASE:
            with self._lock:
                self._owner = None
                self._manual = None
            return
        if kind == contract.EXPLORE_PAUSE:
            with self._lock:
                self._paused = True
            self._status(client_id, window_id, contract.STATE_PAUSED)
        elif kind == contract.EXPLORE_RESUME:
            with self._lock:
                self._paused = False
                self._holding = False
                self._held_capture = None
            # Relearn the empty area, since the desk may have changed while paused.
            self.watcher.reset()
            self._status(client_id, window_id, contract.STATE_WATCHING)
        elif kind == contract.EXPLORE_DISMISS:
            with self._lock:
                self._holding = False
                self._held_capture = None
                paused = self._paused
            self._status(client_id, window_id, contract.STATE_PAUSED if paused else contract.STATE_WATCHING)
        elif kind == contract.EXPLORE_ANALYZE_FRAME:
            request_id = contract.request_id_of(message)
            with self._lock:
                fresh = self._last_frame_at is not None and self._clock() - self._last_frame_at <= FRAME_MAX_AGE_S
                if fresh:
                    self._manual = (client_id, window_id, request_id)
            if not fresh:
                self._send(client_id, contract.ai_error(window_id, request_id, contract.ERR_NO_FRAME,
                                                        "No camera frames are arriving. Check the camera.", "identify"))

    def _status(self, client_id, window_id: str, state: str) -> None:
        problem = self.gemini.configuration_problem()
        self._send(client_id, contract.explore_status(window_id, state, problem or ""))

    # ---- camera loop ----

    def on_frame(self, frame, hands, now: float) -> None:
        """Called for every camera frame. Only cheap work happens here; encoding and API calls are queued."""
        with self._lock:
            self._last_frame_at = now
            owner, paused, holding = self._owner, self._paused, self._holding
            manual, self._manual = self._manual, None
        if owner is None:
            return
        if manual is not None:
            client_id, window_id, request_id = manual
            self._capture(client_id, window_id, request_id, frame, self.watcher.camera_box_for_capture(frame), "manual")
            return
        if paused:
            return
        for event in self.watcher.update(frame, now, hands):
            if event.type == "left":
                with self._lock:
                    capture_id = self._held_capture if self._holding else None
                if capture_id:
                    self._send(owner[0], contract.message(contract.EXPLORE_OBJECT_LEFT, window_id=owner[1], capture_id=capture_id))
            elif event.type == "triggered" and not holding:
                holding = True
                self._capture(owner[0], owner[1], f"auto-{next(self._auto_ids)}", frame, event.box, "auto")

    def _capture(self, client_id, window_id: str, request_id: str, frame, box, trigger: str) -> None:
        try:
            crop = crop_camera_box(frame, box)
        except CaptureError as error:
            self._send(client_id, contract.ai_error(window_id, request_id, contract.ERR_NO_FRAME, str(error), "identify"))
            return
        with self._lock:
            self._holding = True
            self._held_capture = None

        def encode_and_identify():
            try:
                image = encode_jpeg(crop)
            except CaptureError as error:
                raise AIServiceError(contract.ERR_NO_FRAME, str(error)) from error
            capture_id = self.captures.add(image)
            with self._lock:
                if self._owner == (client_id, window_id):
                    self._held_capture = capture_id
            data_url = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")
            self._send(client_id, contract.message(contract.EXPLORE_CAPTURE, window_id=window_id, request_id=request_id,
                                                   capture_id=capture_id, image=data_url, trigger=trigger))
            result = self.gemini.identify(image, "image/jpeg")
            result.identification["capture_id"] = capture_id
            return result

        self._submit(client_id, window_id, request_id, "identify", encode_and_identify)
