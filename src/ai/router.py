"""Routes AI requests between browser windows, the camera loop, and Gemini.

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
from dataclasses import dataclass

from ai import contract
from ai.gemini_service import AIServiceError, GeminiService
from vision.capture import CaptureError, crop_normalized, decode_jpeg, encode_jpeg

# A snapshot needs camera frames at most this old.
FRAME_MAX_AGE_S = 2.0
# The browser blanks the projection before asking; this extra wait covers frames the camera
# had already buffered, so the photo shows the desk without the projected interface.
SNAPSHOT_DELAY_S = 0.25
# Stored full-resolution photo (for sharp crops) and the smaller preview sent to the browser.
FULL_MAX_SIDE = 1920
PREVIEW_MAX_SIDE = 1280
CROP_MAX_SIDE = 1024


@dataclass
class Capture:
    image: bytes
    width: int
    height: int


class CaptureStore:
    """Recent captured images by id, so questions reuse an image without the browser resending it."""

    def __init__(self, limit: int = 20) -> None:
        self._items: OrderedDict[str, Capture] = OrderedDict()
        self._limit = limit
        self._counter = itertools.count(1)
        self._lock = threading.Lock()

    def add(self, image: bytes, width: int, height: int) -> str:
        with self._lock:
            capture_id = f"capture-{next(self._counter)}"
            self._items[capture_id] = Capture(image, width, height)
            while len(self._items) > self._limit:
                self._items.popitem(last=False)
            return capture_id

    def get(self, capture_id: str) -> Capture | None:
        with self._lock:
            return self._items.get(capture_id)


def _data_url(image: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")


class AIRouter:
    def __init__(self, gemini: GeminiService, send, executor=None, max_pending: int = 4,
                 clock=time.monotonic, snapshot_delay_s: float = SNAPSHOT_DELAY_S) -> None:
        """send(client_id, message) must be safe to call from any thread."""
        self.gemini = gemini
        self._send = send
        self._executor = executor or ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai")
        self._max_pending = max_pending
        self._clock = clock
        self._snapshot_delay_s = snapshot_delay_s
        self.captures = CaptureStore()
        self._lock = threading.Lock()
        self._pending = 0
        # Snapshots waiting for a camera frame: (client_id, window_id, request_id, requested_at).
        self._snapshots: list[tuple[object, str, str, float]] = []
        self._last_frame_at: float | None = None

    # ---- messages from browsers (WebSocket thread) ----

    def handle(self, client_id, message) -> bool:
        """Handles AI messages and returns True; returns False for any other message."""
        if not isinstance(message, dict) or message.get("version") != contract.VERSION:
            return False
        kind = message.get("type")
        if kind not in contract.REQUEST_TYPES:
            return False
        try:
            if kind == contract.AI_REQUEST:
                self._handle_ai_request(client_id, contract.parse_ai_request(message))
            elif kind == contract.AI_SNAPSHOT:
                self._handle_snapshot(client_id, contract.window_id_of(message), contract.request_id_of(message))
            else:
                self._handle_crop(client_id, contract.parse_crop(message))
        except contract.ContractError as error:
            window_id = message.get("window_id") if isinstance(message.get("window_id"), str) else None
            request_id = message.get("request_id") if isinstance(message.get("request_id"), str) else None
            print(f"Rejected {kind}: {error}")
            if kind == contract.AI_REQUEST:
                self._send(client_id, contract.ai_error(window_id, request_id, error.code, str(error)))
            else:
                self._send(client_id, contract.capture_error(window_id, request_id, error.code, str(error)))
        return True

    def client_closed(self, client_id) -> None:
        with self._lock:
            self._snapshots = [entry for entry in self._snapshots if entry[0] != client_id]

    def _handle_ai_request(self, client_id, request: contract.AIRequest) -> None:
        image = request.image_bytes
        if image is None and request.capture_id is not None:
            capture = self.captures.get(request.capture_id)
            if capture is None:
                self._send(client_id, contract.ai_error(request.window_id, request.request_id, contract.ERR_NOT_FOUND,
                                                        "That photo is no longer available. Take a new one.", request.task))
                return
            image = capture.image
        if request.task == "describe":
            job = lambda: self.gemini.describe(image, request.image_mime, style=request.style)  # noqa: E731
        else:
            job = lambda: self.gemini.ask(request.prompt, image=image, mime_type=request.image_mime,  # noqa: E731
                                          context=request.context, subject=request.subject,
                                          grounding=request.grounding, style=request.style)

        def answer():
            result = job()
            return contract.ai_response(request.window_id, request.request_id, request.task, result.to_message_fields())

        def failure(code, text):
            return contract.ai_error(request.window_id, request.request_id, code, text, request.task)

        self._submit(client_id, answer, failure)

    def _handle_snapshot(self, client_id, window_id: str, request_id: str) -> None:
        with self._lock:
            fresh = self._last_frame_at is not None and self._clock() - self._last_frame_at <= FRAME_MAX_AGE_S
            if fresh:
                self._snapshots.append((client_id, window_id, request_id, self._clock()))
        if not fresh:
            self._send(client_id, contract.capture_error(window_id, request_id, contract.ERR_NO_FRAME,
                                                         "No camera frames are arriving. Check the camera and src/main.py."))

    def _handle_crop(self, client_id, request: contract.CropRequest) -> None:
        source = self.captures.get(request.capture_id)
        if source is None:
            self._send(client_id, contract.capture_error(request.window_id, request.request_id, contract.ERR_NOT_FOUND,
                                                         "That photo is no longer available. Take a new one."))
            return

        def crop():
            try:
                piece = crop_normalized(decode_jpeg(source.image), request.box)
                image = encode_jpeg(piece, max_side=CROP_MAX_SIDE, quality=90)
            except CaptureError as error:
                raise AIServiceError(contract.ERR_IMAGE, str(error)) from error
            height, width = piece.shape[:2]
            capture_id = self.captures.add(image, width, height)
            return contract.capture_reply(request.window_id, request.request_id, capture_id, _data_url(image), width, height)

        def failure(code, text):
            return contract.capture_error(request.window_id, request.request_id, code, text)

        self._submit(client_id, crop, failure)

    def _submit(self, client_id, job, failure) -> None:
        """Runs job() on a worker thread and sends its reply, or failure(code, text) if it fails."""
        with self._lock:
            busy = self._pending >= self._max_pending
            if not busy:
                self._pending += 1
        if busy:
            self._send(client_id, failure(contract.ERR_BUSY, "Too many AI requests are running. Try again in a moment."))
            return

        def run():
            try:
                reply = job()
            except AIServiceError as error:
                reply = failure(error.code, error.message)
            except Exception as error:  # noqa: BLE001 - a worker must always answer
                print(f"AI job failed: {error!r}")
                reply = failure(contract.ERR_API, "The AI request failed unexpectedly.")
            finally:
                with self._lock:
                    self._pending -= 1
            self._send(client_id, reply)

        self._executor.submit(run)

    # ---- camera loop ----

    def on_frame(self, frame, now: float) -> None:
        """Called for every camera frame. Only copies a frame when a snapshot is due; encoding is queued."""
        with self._lock:
            self._last_frame_at = now
            due = [entry for entry in self._snapshots if now - entry[3] >= self._snapshot_delay_s]
            if not due:
                return
            self._snapshots = [entry for entry in self._snapshots if entry not in due]
        if frame is None or getattr(frame, "size", 0) == 0:
            for client_id, window_id, request_id, _ in due:
                self._send(client_id, contract.capture_error(window_id, request_id, contract.ERR_NO_FRAME, "The camera frame is empty."))
            return
        photo = frame.copy()
        for client_id, window_id, request_id, _ in due:
            self._submit_snapshot(client_id, window_id, request_id, photo)

    def _submit_snapshot(self, client_id, window_id: str, request_id: str, photo) -> None:
        def encode():
            try:
                full = encode_jpeg(photo, max_side=FULL_MAX_SIDE, quality=90)
                preview = encode_jpeg(photo, max_side=PREVIEW_MAX_SIDE, quality=80)
            except CaptureError as error:
                raise AIServiceError(contract.ERR_NO_FRAME, str(error)) from error
            height, width = photo.shape[:2]
            capture_id = self.captures.add(full, width, height)
            return contract.capture_reply(window_id, request_id, capture_id, _data_url(preview), width, height)

        def failure(code, text):
            return contract.capture_error(window_id, request_id, code, text)

        self._submit(client_id, encode, failure)
