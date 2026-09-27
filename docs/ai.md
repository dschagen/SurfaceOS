# AI service: what apps can ask Gemini

The Python process (`src/main.py`) runs one Gemini service that any SurfaceOS app can use. The
browser never sees the API key. Messages travel over the same WebSocket server as hand input
(`ws://localhost:8765`) on their own connection, and replies go only to the connection that asked.
`src/ai/contract.py` validates every message and is the source of truth for the shapes below;
`frontend/ai-client.js` is the browser side.

## Setup

1. Install dependencies: `.venv\Scripts\python -m pip install -r requirements.txt` (adds `google-genai`).
2. Put the key in `.env` at the repository root (git-ignored; `.env.example` shows the format) and
   start the tracker with `.\start_tracker.ps1`, which loads it for that run only. Or set it in the
   terminal yourself: PowerShell `$env:GEMINI_API_KEY = "..."`. Never put the key in a committed file.
3. Model: `ai.model` in `config/settings.json` (default `gemini-3.8-flash`), or override with the
   `GEMINI_MODEL` environment variable. `ai.timeout_s` limits each request (default 30).

Without a key the service still starts. Requests are answered with `missing_key` errors, which the
Ask AI chat shows as its answer.

## Ask AI

A thumbs-up held 0.5 s opens **Voice / Screenshot / Cancel** next to the hand (see `docs/input.md`).
Voice asks where the chat goes and starts a hands-free voice chat. Screenshot first takes a desk photo
(the shell blanks the projection, then sends `ai.snapshot`), then asks where the chat goes; the chat
shows the photo for cropping (`ai.crop`), asks for a one-sentence `describe`, and then runs the same
voice chat with the crop as context. Questions use `style: "spoken"` and `grounding: true`. The
program picker's **Ask AI** entry opens the same chat with the Voice / Screenshot choice inside it.

Speech recognition and spoken replies are the browser's own engines (`frontend/apps/voice.js`,
Chrome or Edge). Only one chat listens at a time, and listening pauses while an answer is spoken.

## Requests (browser to server)

```json
{ "version": 1, "type": "ai.request", "window_id": "window-3", "request_id": "window-3-7-k2j8d",
  "task": "ask", "prompt": "What is it made of?", "capture_id": "capture-4",
  "context": [{ "role": "model", "text": "A blue coffee mug." }],
  "grounding": true, "style": "spoken" }
```

| Field | Rules |
| --- | --- |
| `window_id`, `request_id` | Required, strings of up to 80 characters. Echoed in the reply. |
| `task` | `ask` (answer `prompt`) or `describe` (one sentence about an image; never searches the web). |
| `prompt` | Required for `ask`, up to 2000 characters. |
| `capture_id` | A photo stored by the server (`ai.snapshot` or `ai.crop`). The last 20 are kept. |
| `image` | Or send your own: `{ "mime_type": "image/jpeg" \| "image/png" \| "image/webp", "data": "<base64>" }`, at most 150 KB. |
| `subject` | Optional name of what the question is about. |
| `context` | Optional earlier turns, `role` `user` or `model`; the last 8 are used. |
| `grounding` | `true` lets Gemini use Google Search for external or current facts; sources are returned. |
| `style` | `text` (default) or `spoken`: one to three short sentences meant to be read aloud. |

```json
{ "version": 1, "type": "ai.snapshot", "window_id": "window-3", "request_id": "window-3-8-p1x9q" }
{ "version": 1, "type": "ai.crop", "window_id": "window-3", "request_id": "window-3-9-z0c2m",
  "capture_id": "capture-4", "box": { "x": 0.25, "y": 0.2, "width": 0.4, "height": 0.35 } }
```

`ai.snapshot` takes one full camera frame about 0.25 s after it arrives, so frames the camera had
already buffered (still showing the projection) are skipped. The browser blanks the projection before
sending it. `ai.crop` boxes are in photo-normalized coordinates; a box dragged in any direction is
accepted, and one smaller than 2% of the photo in either direction is rejected.

With `frontend/ai-client.js`:

```js
import { sharedAIClient } from '../ai-client.js';
const ai = sharedAIClient();
const photo = await ai.snapshot(ctx.windowId).promise;          // ai.capture
const crop = await ai.crop(ctx.windowId, photo.capture_id, box).promise;
const reply = await ai.request(ctx.windowId, { task: 'describe', capture_id: crop.capture_id }).promise;
// Never rejects; check reply.ok.
```

## Replies (server to the asking connection)

```json
{ "version": 1, "type": "ai.response", "window_id": "window-3", "request_id": "window-3-7-k2j8d",
  "ok": true, "task": "ask", "text": "...", "sources": [{ "title": "...", "url": "https://..." }],
  "grounded": true, "model": "gemini-3.8-flash", "provider": "gemini" }
{ "version": 1, "type": "ai.capture", "window_id": "window-3", "request_id": "window-3-8-p1x9q",
  "ok": true, "capture_id": "capture-5", "image": "data:image/jpeg;base64,...", "width": 1920, "height": 1080 }
```

`ai.capture` carries a preview (longest side at most 1280 px for a snapshot, 1024 px for a crop);
`width` and `height` are the stored image's size. The server keeps the full-resolution photo, so crops
stay sharp. `search_unavailable: true` in an `ai.response` means search was requested but its quota was
reached, so the answer came without a web lookup.

Only answers with `provider: "gemini"` come from the live model. Test doubles set a different provider,
and the chat labels those answers as tests.

Errors: `{ "ok": false, "error": { "code", "message" } }` in the reply type of the request, with `code`
one of `invalid_request`, `missing_key`, `sdk_missing`, `timeout`, `api_error`, `empty_response`,
`busy` (more than 4 requests running, or Gemini overloaded or rate limited), `no_frame` (no camera
frames in the last 2 s), `capture_not_found`, `image_invalid`. The browser client adds `offline` and
`timeout` (45 s for requests, 6 s for a snapshot).

## Tests

From the repository root:

```bash
cd src && ..\.venv\Scripts\python -m pytest ../tests -q      # includes test_ai_router, test_gemini_service, test_capture
.venv\Scripts\python tools\assistant_smoke.py                # thumbs-up to voice chat and photo crop in the shell; no camera, mic, or key
python tools/dev_server.py 8000                              # then open http://localhost:8000/frontend/app-tests.html
```

Live check with a real key (four small billable requests):

```powershell
.\start_tracker.ps1 -Check path\to\photo.jpg
```
