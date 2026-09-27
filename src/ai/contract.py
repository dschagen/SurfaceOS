"""Message contract between browser apps and the AI service (version 1).

This module is the single definition of the messages; docs/ai.md describes the same shapes for
browser code. Every request carries the window_id and request_id of the window that asked, and
every response echoes both, so a window can ignore replies meant for other windows or superseded
requests.

Browser -> server
  ai.request             {window_id, request_id, task, prompt?, capture_id?, image?, subject?, context?, grounding?}
  explore.watch          {window_id}                watch the camera area for this window
  explore.pause          {window_id}
  explore.resume         {window_id}
  explore.dismiss        {window_id}                "No" or "watch for a new object"
  explore.analyze_frame  {window_id, request_id}    capture now instead of waiting for a trigger
  explore.release        {window_id}                window closed

Server -> browser (only to the connection that owns the window)
  ai.response            {window_id, request_id, ok, task, ...result or error}
  explore.status         {window_id, state, detail}
  explore.capture        {window_id, request_id, capture_id, image, trigger}
  explore.object_left    {window_id, capture_id}
"""

import base64
from dataclasses import dataclass, field

VERSION = 1

AI_REQUEST = "ai.request"
AI_RESPONSE = "ai.response"
EXPLORE_WATCH = "explore.watch"
EXPLORE_PAUSE = "explore.pause"
EXPLORE_RESUME = "explore.resume"
EXPLORE_DISMISS = "explore.dismiss"
EXPLORE_ANALYZE_FRAME = "explore.analyze_frame"
EXPLORE_RELEASE = "explore.release"
EXPLORE_STATUS = "explore.status"
EXPLORE_CAPTURE = "explore.capture"
EXPLORE_OBJECT_LEFT = "explore.object_left"

EXPLORE_REQUESTS = {EXPLORE_WATCH, EXPLORE_PAUSE, EXPLORE_RESUME, EXPLORE_DISMISS,
                    EXPLORE_ANALYZE_FRAME, EXPLORE_RELEASE}

# ask: answer a question, optionally about an image. identify: short identification of an image.
TASKS = {"ask", "identify"}

# Explore states reported to the owning window.
STATE_WATCHING = "watching"
STATE_PAUSED = "paused"
STATE_HOLDING = "holding"         # showing a captured object; no new captures until dismissed
STATE_INACTIVE = "inactive"       # another window took over the camera area

# Error codes in ai.response {ok: false, error: {code, message}}.
ERR_INVALID = "invalid_request"
ERR_MISSING_KEY = "missing_key"
ERR_SDK_MISSING = "sdk_missing"
ERR_TIMEOUT = "timeout"
ERR_API = "api_error"
ERR_EMPTY = "empty_response"
ERR_BUSY = "busy"
ERR_NO_FRAME = "no_frame"
ERR_NOT_FOUND = "capture_not_found"
ERR_IMAGE = "image_invalid"

MAX_ID_LENGTH = 80
MAX_PROMPT_CHARS = 2000
MAX_CONTEXT_TURNS = 8
MAX_SUBJECT_CHARS = 200
MAX_IMAGE_BYTES = 4 * 1024 * 1024
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ContractError(ValueError):
    def __init__(self, message: str, code: str = ERR_INVALID) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Turn:
    role: str  # "user" or "model"
    text: str


@dataclass
class AIRequest:
    window_id: str
    request_id: str
    task: str
    prompt: str = ""
    capture_id: str | None = None
    image_bytes: bytes | None = None
    image_mime: str = "image/jpeg"
    subject: str | None = None
    context: list[Turn] = field(default_factory=list)
    grounding: bool = False


def _text_id(message: dict, key: str) -> str:
    value = message.get(key)
    if not isinstance(value, str) or not value or len(value) > MAX_ID_LENGTH:
        raise ContractError(f"{key} must be a non-empty string of at most {MAX_ID_LENGTH} characters")
    return value


def window_id_of(message: dict) -> str:
    return _text_id(message, "window_id")


def request_id_of(message: dict) -> str:
    return _text_id(message, "request_id")


def parse_ai_request(message: dict) -> AIRequest:
    """Validates an ai.request. Raises ContractError describing the first problem."""
    window_id = window_id_of(message)
    request_id = request_id_of(message)
    task = message.get("task")
    if task not in TASKS:
        raise ContractError(f"task must be one of {sorted(TASKS)}")
    prompt = message.get("prompt", "")
    if not isinstance(prompt, str) or len(prompt) > MAX_PROMPT_CHARS:
        raise ContractError(f"prompt must be a string of at most {MAX_PROMPT_CHARS} characters")
    if task == "ask" and not prompt.strip():
        raise ContractError("an ask request needs a prompt")

    capture_id = message.get("capture_id")
    if capture_id is not None:
        capture_id = _text_id(message, "capture_id")
    image_bytes, image_mime = None, "image/jpeg"
    image = message.get("image")
    if image is not None:
        if not isinstance(image, dict) or not isinstance(image.get("data"), str):
            raise ContractError("image must be {mime_type, data} with base64 data", ERR_IMAGE)
        image_mime = image.get("mime_type", "image/jpeg")
        if image_mime not in IMAGE_MIME_TYPES:
            raise ContractError(f"image mime_type must be one of {sorted(IMAGE_MIME_TYPES)}", ERR_IMAGE)
        if len(image["data"]) > MAX_IMAGE_BYTES * 4 // 3 + 4:
            raise ContractError("image is larger than the 4 MB limit", ERR_IMAGE)
        try:
            image_bytes = base64.b64decode(image["data"], validate=True)
        except (ValueError, TypeError) as error:
            raise ContractError("image data is not valid base64", ERR_IMAGE) from error
        if not image_bytes:
            raise ContractError("image data is empty", ERR_IMAGE)
    if task == "identify" and capture_id is None and image_bytes is None:
        raise ContractError("an identify request needs capture_id or image")

    subject = message.get("subject")
    if subject is not None and (not isinstance(subject, str) or len(subject) > MAX_SUBJECT_CHARS):
        raise ContractError(f"subject must be a string of at most {MAX_SUBJECT_CHARS} characters")

    context = []
    raw_context = message.get("context", [])
    if not isinstance(raw_context, list):
        raise ContractError("context must be a list of {role, text}")
    for turn in raw_context[-MAX_CONTEXT_TURNS:]:
        if not isinstance(turn, dict) or turn.get("role") not in ("user", "model") or not isinstance(turn.get("text"), str):
            raise ContractError("context turns must be {role: 'user' | 'model', text}")
        context.append(Turn(turn["role"], turn["text"][:MAX_PROMPT_CHARS]))

    return AIRequest(window_id=window_id, request_id=request_id, task=task, prompt=prompt.strip(),
                     capture_id=capture_id, image_bytes=image_bytes, image_mime=image_mime,
                     subject=subject.strip() if subject else None, context=context, grounding=message.get("grounding") is True)


def message(message_type: str, **fields) -> dict:
    return {"version": VERSION, "type": message_type, **fields}


def ai_response(window_id: str, request_id: str, task: str, result: dict) -> dict:
    return message(AI_RESPONSE, window_id=window_id, request_id=request_id, ok=True, task=task, **result)


def ai_error(window_id: str | None, request_id: str | None, code: str, text: str, task: str | None = None) -> dict:
    return message(AI_RESPONSE, window_id=window_id, request_id=request_id, ok=False, task=task,
                   error={"code": code, "message": text})


def explore_status(window_id: str, state: str, detail: str = "") -> dict:
    return message(EXPLORE_STATUS, window_id=window_id, state=state, detail=detail)
