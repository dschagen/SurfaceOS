"""Live check of the Gemini service with a real API key. Makes three small, billable requests.

Run from the repository root after setting GEMINI_API_KEY:
  .venv\\Scripts\\python tools\\gemini_check.py [photo.jpg]

Without a photo it captures one frame from camera settings["camera"]["index"].
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import cv2  # noqa: E402

from ai.gemini_service import AIServiceError, GeminiService  # noqa: E402
from settings import load_settings  # noqa: E402
from vision.capture import encode_jpeg  # noqa: E402


def timed(label, call):
    started = time.monotonic()
    try:
        result = call()
    except AIServiceError as error:
        print(f"{label}: FAILED [{error.code}] {error.message}")
        return None
    print(f"{label} ({time.monotonic() - started:.1f} s, model {result.model}, provider {result.provider}):")
    print(f"  {result.text}")
    if result.search_unavailable:
        print("  (web search quota reached; answered without a web search)")
    for source in result.sources:
        print(f"  source: {source['title']} - {source['url']}")
    if result.identification:
        print(f"  identification: {result.identification}")
    return result


def main() -> int:
    settings = load_settings()
    service = GeminiService.from_settings(settings)
    problem = service.configuration_problem()
    if problem:
        print(problem)
        return 2
    if len(sys.argv) > 1:
        image = cv2.imread(sys.argv[1])
        if image is None:
            print(f"Could not read {sys.argv[1]}")
            return 2
    else:
        camera = cv2.VideoCapture(settings["camera"]["index"])
        ok, image = camera.read()
        camera.release()
        if not ok:
            print("Could not read a camera frame; pass a photo path instead.")
            return 2
    jpeg = encode_jpeg(image)
    timed("Text question", lambda: service.ask("In one sentence, what is a projector?"))
    timed("Grounded question", lambda: service.ask("What is today's date, and one current news headline?", grounding=True))
    identified = timed("Identify image", lambda: service.identify(jpeg))
    if identified and identified.identification and not identified.identification["uncertain"]:
        timed("Grounded follow-up", lambda: service.ask("Tell me two facts about it.", image=jpeg,
                                                        subject=identified.identification["label"], grounding=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
