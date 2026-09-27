import json
import unittest
from types import SimpleNamespace

import helpers  # noqa: F401
from ai import contract
from ai.gemini_service import AIServiceError, GeminiService, parse_identification


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


def identify_json(**fields):
    return json.dumps({"object_present": True, "label": "coffee mug", "confidence": "high",
                       "summary": "A white ceramic mug.", **fields})


class GeminiServiceTests(unittest.TestCase):
    def test_identify_sends_image_and_json_schema_without_search(self):
        client = FakeClient(response(identify_json()))
        result = GeminiService("test-model", client=client).identify(b"jpeg-bytes")
        call = client.calls[0]
        self.assertEqual(call["model"], "test-model")
        parts = call["contents"][0]["parts"]
        self.assertEqual(parts[0]["inline_data"], {"data": b"jpeg-bytes", "mime_type": "image/jpeg"})
        self.assertEqual(call["config"]["response_mime_type"], "application/json")
        self.assertNotIn("tools", call["config"], "identification never searches the web")
        self.assertEqual(result.text, "coffee mug")
        self.assertFalse(result.identification["uncertain"])
        self.assertEqual(result.to_message_fields()["provider"], "gemini")

    def test_low_confidence_is_reported_as_uncertain(self):
        client = FakeClient(response(identify_json(label="maybe a stapler", confidence="low")))
        result = GeminiService(client=client).identify(b"x")
        self.assertTrue(result.identification["uncertain"])
        self.assertTrue(result.text.startswith("Not sure what this is."))
        self.assertIn("maybe a stapler", result.text)

    def test_no_object_and_unreadable_output_are_uncertain(self):
        self.assertTrue(parse_identification(identify_json(object_present=False))["uncertain"])
        self.assertTrue(parse_identification("not json")["uncertain"])
        self.assertTrue(parse_identification(json.dumps({"label": "x"}))["uncertain"])
        self.assertEqual(parse_identification(json.dumps({"label": "y" * 500, "confidence": "high", "object_present": True}))["label"], "y" * 80)

    def test_grounded_ask_returns_web_sources(self):
        client = FakeClient(response("It costs about $10.", chunks=[
            ("https://example.com/mug", "Example"), ("https://example.com/mug", "Duplicate"), ("javascript:alert(1)", "Bad")],
            queries=["coffee mug price"]))
        result = GeminiService(client=client).ask("How much is it?", image=b"img", subject="coffee mug", grounding=True)
        call = client.calls[0]
        self.assertEqual(call["config"]["tools"], [{"google_search": {}}])
        text = call["contents"][0]["parts"][-1]["text"]
        self.assertIn("identified as: coffee mug", text)
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

    def test_missing_key_is_a_clear_error_without_calling_the_api(self):
        service = GeminiService(environ={})
        self.assertIn("GEMINI_API_KEY", service.configuration_problem())
        with self.assertRaises(AIServiceError) as caught:
            service.identify(b"x")
        self.assertEqual(caught.exception.code, contract.ERR_MISSING_KEY)

    def test_timeouts_and_api_errors_are_translated(self):
        class ReadTimeout(Exception):
            pass

        class ClientError(Exception):
            def __init__(self, code, message):
                super().__init__(message)
                self.code = code

        cases = [(ReadTimeout("read"), contract.ERR_TIMEOUT), (ClientError(429, "quota"), contract.ERR_BUSY),
                 (ClientError(403, "denied"), contract.ERR_MISSING_KEY), (ClientError(404, "no model"), contract.ERR_API),
                 (RuntimeError("boom"), contract.ERR_API)]
        for error, code in cases:
            with self.assertRaises(AIServiceError) as caught:
                GeminiService(client=FakeClient(error)).ask("hi")
            self.assertEqual(caught.exception.code, code, type(error).__name__)

    def test_overload_is_retried_once_then_reported(self):
        class ServerError(Exception):
            def __init__(self):
                super().__init__("503 UNAVAILABLE")
                self.code = 503

        import ai.gemini_service as module
        module.RETRY_DELAY_S = 0
        client = FakeClient(ServerError(), response("Recovered."))
        self.assertEqual(GeminiService(client=client).ask("hi").text, "Recovered.")
        self.assertEqual(len(client.calls), 2)
        with self.assertRaises(AIServiceError) as caught:
            GeminiService(client=FakeClient(ServerError(), ServerError())).ask("hi")
        self.assertEqual((caught.exception.code, caught.exception.message),
                         (contract.ERR_BUSY, "Gemini is overloaded right now. Try again in a moment."))

    def test_search_quota_falls_back_to_an_answer_without_search(self):
        class ClientError(Exception):
            def __init__(self, code):
                super().__init__(f"{code}")
                self.code = code

        client = FakeClient(ClientError(429), response("Answer without search."))
        result = GeminiService(client=client).ask("Price?", grounding=True)
        self.assertEqual([("tools" in c["config"]) for c in client.calls], [True, False])
        self.assertEqual((result.text, result.grounded, result.search_unavailable), ("Answer without search.", False, True))
        self.assertTrue(result.to_message_fields()["search_unavailable"])
        with self.assertRaises(AIServiceError):
            GeminiService(client=FakeClient(ClientError(429))).ask("Price?")

    def test_no_object_has_no_guessed_label(self):
        result = GeminiService(client=FakeClient(response(identify_json(object_present=False, label="none", confidence="low")))).identify(b"x")
        self.assertEqual(result.identification["label"], "")
        self.assertNotIn("might be", result.text)

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

    def test_model_comes_from_settings_or_environment(self):
        self.assertEqual(GeminiService.from_settings({"ai": {"model": "m1", "timeout_s": 5}}).model, "m1")


class ContractTests(unittest.TestCase):
    def base(self, **fields):
        return {"version": 1, "type": "ai.request", "window_id": "window-1", "request_id": "r1", "task": "ask",
                "prompt": "hi", **fields}

    def test_valid_request(self):
        request = contract.parse_ai_request(self.base(grounding=True, subject="mug",
                                                      context=[{"role": "user", "text": "a"}], image={"mime_type": "image/png", "data": "aGk="}))
        self.assertEqual((request.grounding, request.subject, request.image_bytes, request.image_mime), (True, "mug", b"hi", "image/png"))

    def test_invalid_requests(self):
        bad = [self.base(window_id=""), self.base(request_id=5), self.base(task="delete"), self.base(prompt=""),
               self.base(task="identify", prompt=""), self.base(image={"data": "@@@"}),
               self.base(image={"mime_type": "text/html", "data": "aGk="}), self.base(context=[{"role": "system", "text": "x"}]),
               self.base(prompt="x" * 3000)]
        for message in bad:
            with self.assertRaises(contract.ContractError, msg=str(message)[:80]):
                contract.parse_ai_request(message)


if __name__ == "__main__":
    unittest.main()
