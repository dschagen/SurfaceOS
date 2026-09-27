# Andres's SurfaceOS widgets and apps

## Integrated shell

The full system runs in Carter's shell. From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/surfaceos-shell/frontend/`. Double-click empty space (or **New window**), drag a rectangle, and pick **Workspace**, **Notes**, or one of the apps. Hand input connects automatically to `ws://localhost:8765` when `python src/main.py` or `python tools/fake_pointer_stream.py` is running; the mouse always works.

How the pieces connect:

- `surfaceos-shell/frontend/scripts/hand-bridge.js` forwards the tracker's WebSocket messages to `window.SurfaceOS.dispatchInput`, the same handler the mouse uses. It only transports; gestures stay in `src/` and window logic in the shell.
- `frontend/shell-adapter.js` registers with `window.SurfaceOS.mountWidgetRenderer`. It implements the shell's `renderLayout(layout, host, onAction)` with the widget renderer, and adds optional hooks the shell calls when present: `apps` (menu entries), `mountApp(windowRecord, host, onAction)`, `sync(windowRecords)` after each shell render, and `handleKey(windowId, event)`.
- Hand pointers reach window content through the shell's `surfaceos:window-pointer` event. Mouse pointers are read by the adapter from native pointer events on the window content. Both arrive as contract v1 events in window-local coordinates.
- The shell rebuilds window frames on each render, so the adapter keeps each window's content in a persistent element and moves it into the new frame. App state, canvases, and videos survive moves, focus changes, and lost tracking.

`python tools/integration_smoke.py` runs the whole flow in headless Edge or Chrome: mouse window creation, a calculator computation, a second window through the Workspace layout contract, then a hand-created window through the real WebSocket server, a hand pinch on a widget, and a lost-tracking cancel. `python tools/youtube_smoke.py` tests the YouTube app against the real YouTube player (needs internet).

## Standalone pages

From the repository root, run `python -m http.server 8000 --directory frontend`, then open:

- `http://localhost:8000/apps-demo.html`: every app in a stand-in shell with mouse, keyboard, and hand input. `?open=calculator,chess` picks the starting apps (up to four); `?hand=0` skips the hand tracker connection.
- `http://localhost:8000/app-tests.html` and `http://localhost:8000/widget-tests.html`: browser tests; each shows `ALL TESTS PASSED` or the failures.

For the music app, also run `python tools/media_bridge.py` (standard library only, Windows).

## Apps

| Content type | App | Notes |
| --- | --- | --- |
| `calculator` | Calculator | + - × ÷ and parentheses; own parser, never `eval`. |
| `browser` | Web browser | Mirrors a real Chrome window from the laptop screen with screen capture, because Google and YouTube refuse to load in iframes. View-only. **Choose window** needs a real mouse click; browsers do not allow screen capture from a pinch. |
| `todo` | Todo list | Add by voice, check off, delete, pages of five. |
| `notepad` | Notepad | Dictated sentences, new line, undo, clear (press twice). |
| `calendar` | Calendar | Month view; events added by voice to the selected day. |
| `timer` | Timer | Stopwatch with laps; countdown with presets and an alarm. |
| `pong` | Pong | 1 player vs AI, or 2 players. Player 1 uses the pointer; player 2 uses the Up/Down arrow keys, because the hand input carries one pointer. |
| `chess` | Chess | Full rules (castling, en passant, promotion to queen, check, mate, stalemate). A setup screen offers 2 players or the computer at Easy, Medium, or Hard. The computer searches in a Web Worker (`apps/chess-worker.js`) so the UI stays responsive; Hard thinks for up to about 2 seconds. |
| `music` | Music | Controls whatever plays on the laptop (Spotify, a YouTube tab) with the system media keys, and shows the current track. Needs `tools/media_bridge.py`. |
| `weather` | Weather | Live Open-Meteo forecast for Miami (FIU), no API key, needs internet. |
| `youtube` | YouTube | Plays a video with YouTube's official IFrame Player API (no API key, needs internet). SurfaceOS buttons for play/pause, restart, volume, and mute; a pinch or click on the video toggles playback; **Next demo** cycles built-in videos. Paste a youtube.com or youtu.be link or an 11-character video ID into the field and press Enter or **Load**. The embedded player ignores pointer input, so hand and mouse both go through SurfaceOS controls. If the browser blocks sound (no mouse click on the page yet), it plays muted and says so. |
| `explore` | Explore Object | Watches a camera area for an object, shows the captured photo and Gemini's identification, and asks **Analyze further?** before any web lookup. **Yes** looks it up with Google Search and lists sources; follow-up questions (typed, dictated, or suggested) keep the photo and identity. **Pause**/**Resume** and **Analyze this frame** support live demos. Needs `src/main.py` running with `GEMINI_API_KEY` set; see `docs/ai.md`. |

Todo, notepad, and calendar get text from speech-to-text. The default uses the browser's speech recognition (Chrome or Edge, internet, microphone permission granted once for `localhost`). A physical keyboard also works in the focused window. Another STT engine can replace it (see below).

App data lives in memory only, so reloading the page gives a clean demo.

## Integrate with Carter's shell

Each app owns its state and logic. `mountApp` also adds a `surfaceos-app-<type>` class to the content element, which gives each app its accent color in `widgets.css`. The shell creates the window frame and a dedicated content element, then mounts an app by content type:

```js
import { mountApp, APPS } from './apps/app-host.js';

const app = mountApp(contentElement, {
  type: windowRecord.content,         // a key of APPS
  windowId: windowRecord.id,
  onAction(action) { /* optional: observe widget actions */ },
});
app.handlePointer({ version: 1, type: 'pointer_down', x: localX, y: localY, source: 'hand' });
app.handleKey({ type: 'keydown', key: 'a' });   // keyboard fallback for the focused window
app.receiveText('buy milk');                     // text from an external STT engine
app.destroy();                                   // when the window closes
```

`APPS[type].title` gives a display name for the content menu. The shell routes pointers exactly as for the renderer: convert to coordinates normalized to the content element, keep a press with the same window until release or cancel, and do not dispatch widget pointers during window creation, move, or resize. Resizing the content element re-lays out the app automatically.

Screen capture (Web browser) and speech recognition need a secure context, which `http://localhost` is. The mouse adapter should dispatch `pointer_up` inside the real `pointerup` handler so the capture picker counts as a user gesture.

Options for `mountApp`:

- `dictation`: a replacement STT provider with the shape `{ supported, start({ onInterim, onFinal, onError, onEnd }) -> stop }`.
- `services`: `{ mediaBridgeUrl, weather: { name, latitude, longitude } }` overrides.
- `warn(message, detail)`: replaces `console.warn` for renderer warnings.

## Renderer

`createWidgetRenderer(container, { onAction, warn })` from `widget-renderer.js` draws one window's layout and returns `renderLayout`, `handlePointer`, `getElement`, and `clear`. Include `widgets.css`. Apps use it through `mountApp`; the shell can also use it directly with the layout contract in `CLAUDE.md`.

A button activates only if pressed and released over the same button. A canceled press never activates. `handlePointer` returns `true` when the event landed on a button (down or move), activated one (up), or canceled a press in progress. Events without `version: 1` are ignored. All displayed text uses `textContent`, so layout text is never parsed as HTML. Unknown widget types, missing or duplicate IDs, and invalid rectangles are skipped; each skip is logged and listed in a visible warning box inside that window. An invalid layout is rejected with a warning and the previous content stays in place.

Additions to the v1 layout contract, all optional and backward compatible:

- Widget types `canvas` and `video`. App code reaches their elements through `getElement(id)` to draw or attach a stream; layout data still carries no code.
- Widget type `embed`: an empty container that app code fills (the YouTube player). The renderer never moves an existing element, because moving an iframe reloads it; stacking follows layout order through `z-index`.
- Widget type `input`: a native one-line text field with optional `value` and `placeholder`. It emits `{ event: "change", value }` on every edit and `{ event: "submit", value }` on Enter. A re-render only replaces the text when the layout's `value` changes, so typing is never overwritten. Hand input cannot type; keep a button path for anything essential.
- `variant`: a string or list of style tokens (`[a-z0-9-]`), applied only as `surfaceos-v-*` class names.
- `disabled: true` on a button: drawn dimmed and never activates.
- `icon`: the name of a built-in line icon from `icons.js` (for example `play`, `mic`, `trash`, `sun`), drawn before the text or alone. Unknown names are skipped with a warning; layout data never carries SVG.
- Elements are reused across renders by widget id. A press in progress survives a re-render while its button still exists and is enabled; it is canceled if the button disappears, becomes disabled, or the layout is for a different window.

Contract version stays **1**. The shell must keep window IDs unique.

## Media bridge

`python tools/media_bridge.py [--port 8766]` listens on `127.0.0.1` only. `GET /media/status` returns the current track; `POST /media/<command>` presses a media key, where the command is `play_pause`, `next`, `previous`, `volume_up`, `volume_down`, or `mute`. POST requests need the `X-SurfaceOS: 1` header, and browser requests are accepted only from `localhost` pages, so other websites cannot trigger media keys. Track info comes from the Windows media session API through a background PowerShell process.
