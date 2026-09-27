"""Message contract between browser apps and the AI service (version 1).

This module is the single definition of the messages; docs/ai.md describes the same shapes for
browser code. Every request carries the window_id and request_id of the window that asked, and
every reply echoes both, so a window can ignore replies meant for other windows or superseded
requests. Replies go only to the browser connection that asked.

Browser -> server
  ai.request   {window_id, request_id, task, prompt?, capture_id?, image?, subject?, context?, grounding?, style?}
  ai.snapshot  {window_id, request_id}                       one full camera frame of the desk
  ai.crop      {window_id, request_id, capture_id, box}       part of a stored capture as a new capture

Server -> browser
  ai.response  {window_id, request_id, ok, task, text, sources, grounded, model, provider, ...} or error
  ai.capture   {window_id, request_id, ok, capture_id, image, width, height} or error
"""

import base64
import math
from dataclasses import dataclass, field

VERSION = 1

AI_REQUEST = "ai.request"
AI_SNAPSHOT = "ai.snapshot"
AI_CROP = "ai.crop"
AI_RESPONSE = "ai.response"
AI_CAPTURE = "ai.capture"

REQUEST_TYPES = {AI_REQUEST, AI_SNAPSHOT, AI_CROP}

# ask: answer a question, optionally about an image. describe: one sentence about an image.
TASKS = {"ask", "describe"}
# spoken: short plain sentences meant to be read aloud. text: normal written answer.
STYLES = {"text", "spoken"}

# Error codes in {ok: false, error: {code, message}}.
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
# Browser messages are limited to 256 KB by the server; base64 adds a third.
MAX_IMAGE_BYTES = 150_000
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
# A crop smaller than this share of the photo in either direction is almost certainly a stray tap.
MIN_CROP_FRACTION = 0.02


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
    style: str = "text"


@dataclass
class CropRequest:
    window_id: str
    request_id: str
    capture_id: str
    # Image-normalized x, y, width, height, clamped to the image.
    box: tuple[float, float, float, float]


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
    style = message.get("style", "text")
    if style not in STYLES:
        raise ContractError(f"style must be one of {sorted(STYLES)}")

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
            raise ContractError("image is larger than the 150 KB limit", ERR_IMAGE)
        try:
            image_bytes = base64.b64decode(image["data"], validate=True)
        except (ValueError, TypeError) as error:
            raise ContractError("image data is not valid base64", ERR_IMAGE) from error
        if not image_bytes:
            raise ContractError("image data is empty", ERR_IMAGE)
    if task == "describe" and capture_id is None and image_bytes is None:
        raise ContractError("a describe request needs capture_id or image")

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
                     subject=subject.strip() if subject else None, context=context,
                     grounding=message.get("grounding") is True, style=style)


def parse_crop(message: dict) -> CropRequest:
    """Validates an ai.crop. The box is clamped to the image and must not be tiny."""
    window_id = window_id_of(message)
    request_id = request_id_of(message)
    capture_id = _text_id(message, "capture_id")
    box = message.get("box")
    if not isinstance(box, dict):
        raise ContractError("box must be {x, y, width, height} in image-normalized coordinates")
    try:
        x, y, width, height = (float(box[key]) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError) as error:
        raise ContractError("box needs numeric x, y, width, and height") from error
    if not all(math.isfinite(v) for v in (x, y, width, height)):
        raise ContractError("box values must be finite numbers")
    left, top = max(0.0, min(x, x + width)), max(0.0, min(y, y + height))
    right, bottom = min(1.0, max(x, x + width)), min(1.0, max(y, y + height))
    if right - left < MIN_CROP_FRACTION or bottom - top < MIN_CROP_FRACTION:
        raise ContractError("the selected area is too small; drag a larger box")
    box = tuple(round(value, 6) for value in (left, top, right - left, bottom - top))
    return CropRequest(window_id, request_id, capture_id, box)


def message(message_type: str, **fields) -> dict:
    return {"version": VERSION, "type": message_type, **fields}


def ai_response(window_id: str, request_id: str, task: str, result: dict) -> dict:
    return message(AI_RESPONSE, window_id=window_id, request_id=request_id, ok=True, task=task, **result)


def ai_error(window_id: str | None, request_id: str | None, code: str, text: str, task: str | None = None) -> dict:
    return message(AI_RESPONSE, window_id=window_id, request_id=request_id, ok=False, task=task,
                   error={"code": code, "message": text})


def capture_reply(window_id: str, request_id: str, capture_id: str, image_url: str, width: int, height: int) -> dict:
    return message(AI_CAPTURE, window_id=window_id, request_id=request_id, ok=True, capture_id=capture_id,
                   image=image_url, width=width, height=height)


def capture_error(window_id: str | None, request_id: str | None, code: str, text: str) -> dict:
    return message(AI_CAPTURE, window_id=window_id, request_id=request_id, ok=False,
                   error={"code": code, "message": text})
