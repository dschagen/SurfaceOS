# AI service: what apps can ask Gemini

The Python process (`src/main.py`) runs one Gemini service that any SurfaceOS app can use. The
browser never sees the API key. Messages travel over the same WebSocket as hand input
(`ws://localhost:8765`), but replies go only to the connection that asked. `src/ai/contract.py`
validates every message and is the source of truth for the shapes below.

## Setup

1. Install dependencies: `.venv\Scripts\python -m pip install -r requirements.txt` (adds `google-genai`).
2. Set the key for the terminal that starts the tracker, never in a file that is committed:
   PowerShell `$env:GEMINI_API_KEY = "..."`, cmd `set GEMINI_API_KEY=...`.
3. Model: `ai.model` in `config/settings.json` (default `gemini-3.8-flash`), or override with the
   `GEMINI_MODEL` environment variable. `ai.timeout_s` limits each request (default 30).

Without a key the service still starts. Requests are answered with `missing_key` errors, and the
Explore Object window shows the setup message.

## Requests (browser to server)

```json
{ "version": 1, "type": "ai.request", "window_id": "window-3", "request_id": "window-3-7-k2j8d",
  "task": "ask", "prompt": "What is it made of?",
  "capture_id": "capture-4", "subject": "coffee mug",
  "context": [{ "role": "model", "text": "A mug holds hot drinks." }],
  "grounding": true }
```

| Field | Rules |
| --- | --- |
| `window_id`, `request_id` | Required, strings of up to 80 characters. Echoed in the reply. |
| `task` | `ask` (answer `prompt`) or `identify` (short identification of an image). |
| `prompt` | Required for `ask`, up to 2000 characters. |
| `capture_id` | An image captured by the server (Explore Object). Kept for the last 20 captures. |
| `image` | Or send your own: `{ "mime_type": "image/jpeg" \| "image/png" \| "image/webp", "data": "<base64>" }`, at most 4 MB. |
| `subject` | Optional name of the object the question is about. |
| `context` | Optional earlier turns, `role` `user` or `model`; the last 8 are used. |
| `grounding` | `true` lets Gemini use Google Search for external or current facts; sources are returned. |

With `frontend/ai-client.js`:

```js
import { sharedAIClient } from '../ai-client.js';
const ai = sharedAIClient();
const { promise } = ai.request(ctx.windowId, { task: 'ask', prompt: 'Summarize this', grounding: false });
const reply = await promise; // never rejects; check reply.ok
```

## Replies (server to the asking connection)

```json
{ "version": 1, "type": "ai.response", "window_id": "window-3", "request_id": "window-3-7-k2j8d",
  "ok": true, "task": "ask", "text": "...", "sources": [{ "title": "...", "url": "https://..." }],
  "grounded": true, "model": "gemini-3.8-flash", "provider": "gemini" }
```

`identify` replies also carry `identification`:
`{ label, confidence: "high" | "medium" | "low", uncertain, object_present, summary }`. Treat
`uncertain: true` as "not sure", never as a confident label.

Only answers with `provider: "gemini"` come from the live model. Test doubles set a different provider.

Errors: `{ "ok": false, "error": { "code", "message" } }`, with `code` one of `invalid_request`,
`missing_key`, `sdk_missing`, `timeout`, `api_error`, `empty_response`, `busy` (more than 4 requests
running), `no_frame`, `capture_not_found`, `image_invalid`. The browser client adds `offline` and
`timeout` (45 s without a reply).

## Explore Object messages

One window at a time watches the camera area (`explore.roi` in `config/settings.json`,
camera-normalized x, y, width, height; drawn on the tracker's preview window).

| Browser sends | Effect |
| --- | --- |
| `explore.watch {window_id}` | This window takes over the camera area. |
| `explore.pause` / `explore.resume` | Stop and start detection. Resume relearns the empty area. |
| `explore.dismiss` | "No" or "New object": watch for the next object. |
| `explore.analyze_frame {window_id, request_id}` | Capture now, without waiting for a trigger. |
| `explore.release` | Window closed. |

| Server sends | Meaning |
| --- | --- |
| `explore.status {state, detail}` | `watching`, `paused`, or `inactive` (another window took over). `detail` carries setup problems. |
| `explore.capture {request_id, capture_id, image, trigger}` | A JPEG data URL (longest side at most 1024 px); the `ai.response` for the same `request_id` follows. |
| `explore.object_left {capture_id}` | The captured object was removed. |

Detection runs locally on each camera frame: it compares a downscaled view of the area with a learned
picture of it while empty, ignores areas covered by tracked hands, and triggers once an object has been
still for `stable_s` (0.8 s). A cooldown (`cooldown_s`, 4 s) and an image signature of recent objects
(`dedup_window_s`, 30 s) keep the same object from being submitted again. An object already on the desk
when watching starts counts as part of the empty area; use **Analyze this frame** for it. Gemini is
called only after a trigger or a button press, never per frame, and never on the camera loop.

## Tests

From the repository root:

```bash
cd tests && ..\.venv\Scripts\python -m unittest            # includes test_object_watch, test_gemini_service, test_ai_router, test_server_transport
.venv\Scripts\python tools\explore_smoke.py                # shell + server + router in a browser, synthetic camera, stand-in Gemini client
python -m http.server 8000                                 # then open http://localhost:8000/frontend/app-tests.html
```

Live check with a real key (three small billable requests):

```powershell
$env:GEMINI_API_KEY = "..."
.venv\Scripts\python tools\gemini_check.py path\to\photo.jpg
```
