"""Server-side Gemini access shared by every SurfaceOS app.

The API key is read from the GEMINI_API_KEY environment variable and never leaves this process.
Requests are built as plain dictionaries, which the google-genai SDK accepts, so tests can inspect
exactly what would be sent. Calls block; run them on a worker thread, never the camera loop.
"""

import os
import time
from dataclasses import dataclass, field

from ai import contract

DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_TIMEOUT_S = 30.0
MAX_SOURCES = 6
RETRY_DELAY_S = 1.5

SYSTEM_INSTRUCTION = (
    "You answer inside SurfaceOS, a projected workspace on a desk. Answers appear in a small window: "
    "use plain text without markdown, at most about 120 words. If you are not sure, say so plainly."
)

# Appended to the system instruction for answers the browser reads aloud.
SPOKEN_INSTRUCTION = (
    " This answer will be spoken aloud: reply in one to three short, conversational sentences, "
    "with no lists, headings, symbols, or web addresses."
)

DESCRIBE_PROMPT = (
    "This image is part of a photo taken by a camera looking down at a desk. "
    "In one sentence, say what it shows. If it is unclear, say so instead of guessing."
)


class AIServiceError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class AIResult:
    text: str
    model: str
    sources: list[dict] = field(default_factory=list)
    grounded: bool = False
    # True when search was requested but unavailable, so the answer came without a web lookup.
    search_unavailable: bool = False
    # Who produced the answer. Only real Gemini responses say "gemini"; test doubles must not.
    provider: str = "gemini"

    def to_message_fields(self) -> dict:
        fields = {"text": self.text, "sources": self.sources, "grounded": self.grounded,
                  "model": self.model, "provider": self.provider}
        if self.search_unavailable:
            fields["search_unavailable"] = True
        return fields


def _source_list(response) -> tuple[list[dict], bool]:
    """Web sources from grounding metadata, deduplicated, http(s) only."""
    candidates = getattr(response, "candidates", None) or []
    metadata = getattr(candidates[0], "grounding_metadata", None) if candidates else None
    if metadata is None:
        return [], False
    sources, seen = [], set()
    for chunk in getattr(metadata, "grounding_chunks", None) or []:
        web = getattr(chunk, "web", None)
        uri = getattr(web, "uri", None) if web else None
        if not isinstance(uri, str) or not uri.startswith(("https://", "http://")) or uri in seen:
            continue
        seen.add(uri)
        title = getattr(web, "title", None) or getattr(web, "domain", None) or uri
        sources.append({"title": str(title)[:120], "url": uri})
        if len(sources) >= MAX_SOURCES:
            break
    searched = bool(getattr(metadata, "web_search_queries", None)) or bool(sources)
    return sources, searched


def _response_text(response) -> str:
    try:
        text = response.text
    except (ValueError, AttributeError):
        text = None
    if not text or not text.strip():
        candidates = getattr(response, "candidates", None) or []
        reason = getattr(candidates[0], "finish_reason", None) if candidates else None
        suffix = f" (finish reason: {getattr(reason, 'name', reason)})" if reason else ""
        raise AIServiceError(contract.ERR_EMPTY, f"Gemini returned no answer{suffix}.")
    return text.strip()


class GeminiService:
    def __init__(self, model: str = DEFAULT_MODEL, timeout_s: float = DEFAULT_TIMEOUT_S,
                 client=None, environ=None, provider: str = "gemini") -> None:
        self.model = model
        # Tests that inject a fake client must pass their own provider so output is never shown as live.
        self.provider = provider
        self.timeout_s = timeout_s
        self._client = client
        self._environ = os.environ if environ is None else environ

    @classmethod
    def from_settings(cls, settings: dict, client=None) -> "GeminiService":
        ai_settings = settings.get("ai", {})
        model = os.environ.get("GEMINI_MODEL") or ai_settings.get("model") or DEFAULT_MODEL
        return cls(model=model, timeout_s=float(ai_settings.get("timeout_s", DEFAULT_TIMEOUT_S)), client=client)

    def configuration_problem(self) -> str | None:
        """A readable reason the service cannot run, or None. Does not reveal the key."""
        if self._client is not None:
            return None
        if not self._environ.get("GEMINI_API_KEY"):
            return "Gemini is not configured. Put GEMINI_API_KEY=your-key in .env at the repository root, then restart src/main.py."
        try:
            import google.genai  # noqa: F401
        except ImportError:
            return "The google-genai package is not installed. Run: pip install -r requirements.txt"
        return None

    def _get_client(self):
        if self._client is not None:
            return self._client
        key = self._environ.get("GEMINI_API_KEY")
        if not key:
            raise AIServiceError(contract.ERR_MISSING_KEY, self.configuration_problem())
        try:
            from google import genai
        except ImportError as error:
            raise AIServiceError(contract.ERR_SDK_MISSING, self.configuration_problem()) from error
        self._client = genai.Client(api_key=key, http_options={"timeout": int(self.timeout_s * 1000)})
        return self._client

    def _generate(self, contents: list, config: dict):
        client = self._get_client()
        # SurfaceOS never registers Python functions as tools, so the SDK's automatic calling stays off.
        config = {**config, "automatic_function_calling": {"disable": True}}
        for attempt in range(2):
            try:
                return client.models.generate_content(model=self.model, contents=contents, config=config)
            except Exception as error:  # noqa: BLE001 - every SDK or network failure becomes a coded error
                # One quick retry when Gemini reports it is overloaded, which is usually brief.
                if attempt == 0 and getattr(error, "code", None) in (500, 503):
                    time.sleep(RETRY_DELAY_S)
                    continue
                raise self._translate(error) from error

    def _translate(self, error: Exception) -> AIServiceError:
        name = type(error).__name__.lower()
        text = str(error)
        key = self._environ.get("GEMINI_API_KEY")
        if key:
            text = text.replace(key, "[key]")
        if isinstance(error, TimeoutError) or "timeout" in name or "timed out" in text.lower():
            return AIServiceError(contract.ERR_TIMEOUT, f"Gemini did not answer within {self.timeout_s:g} seconds.")
        code = getattr(error, "code", None)
        if code in (401, 403) or "api key" in text.lower():
            return AIServiceError(contract.ERR_MISSING_KEY, "Gemini rejected the API key. Check GEMINI_API_KEY.")
        if code in (500, 503):
            return AIServiceError(contract.ERR_BUSY, "Gemini is overloaded right now. Try again in a moment.")
        if code == 429:
            error = AIServiceError(contract.ERR_BUSY, "Gemini rate limit reached. Wait a moment and try again.")
            error.rate_limited = True
            return error
        if code == 404:
            return AIServiceError(contract.ERR_API, f"Gemini model '{self.model}' was not found. Set ai.model or GEMINI_MODEL.")
        return AIServiceError(contract.ERR_API, f"Gemini request failed: {text[:200]}")

    @staticmethod
    def _image_part(image: bytes, mime_type: str) -> dict:
        return {"inline_data": {"data": image, "mime_type": mime_type}}

    @staticmethod
    def _config(style: str, temperature: float) -> dict:
        instruction = SYSTEM_INSTRUCTION + (SPOKEN_INSTRUCTION if style == "spoken" else "")
        return {"system_instruction": instruction, "temperature": temperature}

    def describe(self, image: bytes, mime_type: str = "image/jpeg", style: str = "text") -> AIResult:
        """One sentence about what an image shows. Never searches the web."""
        if not image:
            raise AIServiceError(contract.ERR_IMAGE, "The image is empty.")
        parts = [self._image_part(image, mime_type), {"text": DESCRIBE_PROMPT}]
        response = self._generate([{"role": "user", "parts": parts}], self._config(style, 0.2))
        return AIResult(text=_response_text(response), model=self.model, provider=self.provider)

    def ask(self, prompt: str, image: bytes | None = None, mime_type: str = "image/jpeg",
            context: list[contract.Turn] | None = None, subject: str | None = None,
            grounding: bool = False, style: str = "text") -> AIResult:
        """Answers a question. With grounding the model may run Google Search for current facts."""
        if not prompt.strip():
            raise AIServiceError(contract.ERR_INVALID, "The question is empty.")
        lines = []
        if subject:
            lines.append(f"The conversation is about: {subject}.")
        if context:
            lines.append("Conversation so far:")
            lines.extend(f"{'User' if turn.role == 'user' else 'Assistant'}: {turn.text}" for turn in context)
        lines.append(f"Question: {prompt}" if lines else prompt)
        parts = [self._image_part(image, mime_type)] if image else []
        parts.append({"text": "\n".join(lines)})
        config = self._config(style, 0.4)
        contents = [{"role": "user", "parts": parts}]
        search_unavailable = False
        if grounding:
            try:
                response = self._generate(contents, {**config, "tools": [{"google_search": {}}]})
            except AIServiceError as error:
                # Search grounding has its own, smaller quota; answer without it rather than not at all.
                if not getattr(error, "rate_limited", False):
                    raise
                search_unavailable = True
                response = self._generate(contents, config)
        else:
            response = self._generate(contents, config)
        text = _response_text(response)
        sources, searched = _source_list(response)
        return AIResult(text=text, model=self.model, sources=sources, grounded=searched,
                        search_unavailable=search_unavailable, provider=self.provider)
