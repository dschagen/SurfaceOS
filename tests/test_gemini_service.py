import unittest
from types import SimpleNamespace
from unittest import mock

import helpers  # noqa: F401
from ai import contract
from ai.gemini_service import SPOKEN_INSTRUCTION, AIServiceError, GeminiService


def response(text, chunks=None, queries=None, finish_reason=None):
    metadata = None
    if chunks is not None or queries is not None:
        metadata = SimpleNamespace(
            grounding_chunks=[SimpleNamespace(web=SimpleNamespace(uri=uri, title=title, domain=None)) for uri, title in chunks or []],
            web_search_queries=queries or [])
    return SimpleNamespace(text=text, candidates=[SimpleNamespace(grounding_metadata=metadata, finish_reason=finish_reason)])


class FakeClient:
    """Stands in for google.genai.Client; records each generate_content call."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


class ClientError(Exception):
    def __init__(self, code, message="error"):
        super().__init__(message)
        self.code = code


class GeminiServiceTests(unittest.TestCase):
    def test_describe_sends_the_image_without_search(self):
        client = FakeClient(response("A white mug on a wooden desk."))
        result = GeminiService("test-model", client=client).describe(b"jpeg-bytes")
        call = client.calls[0]
        self.assertEqual(call["model"], "test-model")
        parts = call["contents"][0]["parts"]
        self.assertEqual(parts[0]["inline_data"], {"data": b"jpeg-bytes", "mime_type": "image/jpeg"})
        self.assertIn("one sentence", parts[1]["text"])
        self.assertNotIn("tools", call["config"], "describing never searches the web")
        self.assertEqual(result.text, "A white mug on a wooden desk.")
        self.assertEqual(result.to_message_fields()["provider"], "gemini")

    def test_describe_needs_an_image(self):
        with self.assertRaises(AIServiceError) as caught:
            GeminiService(client=FakeClient()).describe(b"")
        self.assertEqual(caught.exception.code, contract.ERR_IMAGE)

    def test_spoken_style_asks_for_short_plain_sentences(self):
        client = FakeClient(response("It is a mug."), response("It is a mug."))
        GeminiService(client=client).ask("What is it?", style="spoken")
        GeminiService(client=client).ask("What is it?")
        spoken, written = (call["config"]["system_instruction"] for call in client.calls)
        self.assertIn(SPOKEN_INSTRUCTION, spoken)
        self.assertNotIn(SPOKEN_INSTRUCTION, written)

    def test_grounded_ask_returns_web_sources(self):
        client = FakeClient(response("It costs about $10.", chunks=[
            ("https://example.com/mug", "Example"), ("https://example.com/mug", "Duplicate"), ("javascript:alert(1)", "Bad")],
            queries=["coffee mug price"]))
        result = GeminiService(client=client).ask("How much is it?", image=b"img", subject="coffee mug", grounding=True)
        call = client.calls[0]
        self.assertEqual(call["config"]["tools"], [{"google_search": {}}])
        text = call["contents"][0]["parts"][-1]["text"]
        self.assertIn("about: coffee mug", text)
        self.assertIn("Question: How much is it?", text)
        self.assertEqual(result.sources, [{"title": "Example", "url": "https://example.com/mug"}])
        self.assertTrue(result.grounded)

    def test_ungrounded_ask_has_no_search_tool_and_keeps_context(self):
        client = FakeClient(response("Ceramic."))
        context = [contract.Turn("user", "What is it?"), contract.Turn("model", "A mug.")]
        result = GeminiService(client=client).ask("What is it made of?", context=context)
        self.assertNotIn("tools", client.calls[0]["config"])
        text = client.calls[0]["contents"][0]["parts"][-1]["text"]
        self.assertIn("User: What is it?\nAssistant: A mug.", text)
        self.assertFalse(result.grounded)
        self.assertEqual(result.sources, [])

    def test_automatic_function_calling_is_always_off(self):
        client = FakeClient(response("a"), response("b"))
        GeminiService(client=client).ask("hi", grounding=True)
        GeminiService(client=client).describe(b"x")
        self.assertTrue(all(call["config"]["automatic_function_calling"] == {"disable": True} for call in client.calls))

    def test_missing_key_is_a_clear_error_without_calling_the_api(self):
        service = GeminiService(environ={})
        self.assertIn("GEMINI_API_KEY", service.configuration_problem())
        with self.assertRaises(AIServiceError) as caught:
            service.describe(b"x")
        self.assertEqual(caught.exception.code, contract.ERR_MISSING_KEY)

    def test_timeouts_and_api_errors_are_translated(self):
        class ReadTimeout(Exception):
            pass

        cases = [(ReadTimeout("read"), contract.ERR_TIMEOUT), (ClientError(429, "quota"), contract.ERR_BUSY),
                 (ClientError(403, "denied"), contract.ERR_MISSING_KEY), (ClientError(404, "no model"), contract.ERR_API),
                 (RuntimeError("boom"), contract.ERR_API)]
        for error, code in cases:
            with self.assertRaises(AIServiceError) as caught:
                GeminiService(client=FakeClient(error)).ask("hi")
            self.assertEqual(caught.exception.code, code, type(error).__name__)

    def test_overload_is_retried_once_then_reported(self):
        with mock.patch("ai.gemini_service.RETRY_DELAY_S", 0):
            client = FakeClient(ClientError(503), response("Recovered."))
            self.assertEqual(GeminiService(client=client).ask("hi").text, "Recovered.")
            self.assertEqual(len(client.calls), 2)
            with self.assertRaises(AIServiceError) as caught:
                GeminiService(client=FakeClient(ClientError(503), ClientError(503))).ask("hi")
        self.assertEqual((caught.exception.code, caught.exception.message),
                         (contract.ERR_BUSY, "Gemini is overloaded right now. Try again in a moment."))

    def test_search_quota_falls_back_to_an_answer_without_search(self):
        client = FakeClient(ClientError(429), response("Answer without search."))
        result = GeminiService(client=client).ask("Price?", grounding=True)
        self.assertEqual([("tools" in c["config"]) for c in client.calls], [True, False])
        self.assertEqual((result.text, result.grounded, result.search_unavailable), ("Answer without search.", False, True))
        self.assertTrue(result.to_message_fields()["search_unavailable"])
        with self.assertRaises(AIServiceError):
            GeminiService(client=FakeClient(ClientError(429))).ask("Price?")

    def test_error_messages_never_contain_the_key(self):
        service = GeminiService(client=FakeClient(RuntimeError("bad request for key sk-secret-123")),
                                environ={"GEMINI_API_KEY": "sk-secret-123"})
        with self.assertRaises(AIServiceError) as caught:
            service.ask("hi")
        self.assertNotIn("sk-secret-123", caught.exception.message)

    def test_empty_answer_is_an_error(self):
        with self.assertRaises(AIServiceError) as caught:
            GeminiService(client=FakeClient(response("", finish_reason="SAFETY"))).ask("hi")
        self.assertEqual(caught.exception.code, contract.ERR_EMPTY)
        self.assertIn("SAFETY", caught.exception.message)

    def test_model_comes_from_settings(self):
        with mock.patch.dict("os.environ", {}, clear=False) as environ:
            environ.pop("GEMINI_MODEL", None)
            self.assertEqual(GeminiService.from_settings({"ai": {"model": "m1", "timeout_s": 5}}).model, "m1")

    def test_test_doubles_are_labelled_as_such(self):
        result = GeminiService(client=FakeClient(response("a")), provider="test-double").ask("hi")
        self.assertEqual(result.to_message_fields()["provider"], "test-double")


class ContractTests(unittest.TestCase):
    def base(self, **fields):
        return {"version": 1, "type": "ai.request", "window_id": "window-1", "request_id": "r1", "task": "ask",
                "prompt": "hi", **fields}

    def test_valid_request(self):
        request = contract.parse_ai_request(self.base(grounding=True, subject="mug", style="spoken",
                                                      context=[{"role": "user", "text": "a"}], image={"mime_type": "image/png", "data": "aGk="}))
        self.assertEqual((request.grounding, request.subject, request.image_bytes, request.image_mime, request.style),
                         (True, "mug", b"hi", "image/png", "spoken"))
        describe = contract.parse_ai_request(self.base(task="describe", prompt="", capture_id="capture-1"))
        self.assertEqual((describe.task, describe.capture_id, describe.style), ("describe", "capture-1", "text"))

    def test_invalid_requests(self):
        bad = [self.base(window_id=""), self.base(request_id=5), self.base(task="identify"), self.base(prompt=""),
               self.base(task="describe", prompt=""), self.base(image={"data": "@@@"}),
               self.base(image={"mime_type": "text/html", "data": "aGk="}), self.base(context=[{"role": "system", "text": "x"}]),
               self.base(prompt="x" * 3000), self.base(style="shout"), self.base(image={"data": "A" * 250_000})]
        for message in bad:
            with self.assertRaises(contract.ContractError, msg=str(message)[:80]):
                contract.parse_ai_request(message)

    def test_crop_box_is_normalized_and_clamped(self):
        def crop(box):
            return contract.parse_crop({"window_id": "w", "request_id": "r", "capture_id": "capture-1", "box": box})

        self.assertEqual(crop({"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}).box, (0.1, 0.2, 0.3, 0.4))
        # A box dragged up and to the left, and one hanging off the image, still become a valid area.
        flipped = crop({"x": 0.5, "y": 0.5, "width": -0.2, "height": -0.3}).box
        self.assertEqual(tuple(round(v, 6) for v in flipped), (0.3, 0.2, 0.2, 0.3))
        clamped = crop({"x": 0.8, "y": -0.2, "width": 0.5, "height": 0.5}).box
        self.assertEqual(tuple(round(v, 6) for v in clamped), (0.8, 0.0, 0.2, 0.3))
        for bad in [None, {"x": 0.1}, {"x": "a", "y": 0, "width": 1, "height": 1},
                    {"x": 0.5, "y": 0.5, "width": 0.001, "height": 0.4}, {"x": float("nan"), "y": 0, "width": 1, "height": 1}]:
            with self.assertRaises(contract.ContractError, msg=str(bad)):
                crop(bad)


if __name__ == "__main__":
    unittest.main()
