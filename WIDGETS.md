# Andres's SurfaceOS widgets and apps

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
| `chess` | Chess | Full rules (castling, en passant, promotion to queen, check, mate, stalemate). Two players or vs a simple computer. |
| `music` | Music | Controls whatever plays on the laptop (Spotify, a YouTube tab) with the system media keys, and shows the current track. Needs `tools/media_bridge.py`. |
| `weather` | Weather | Live Open-Meteo forecast for Miami (FIU), no API key, needs internet. |

Todo, notepad, and calendar get text from speech-to-text. The default uses the browser's speech recognition (Chrome or Edge, internet, microphone permission granted once for `localhost`). A physical keyboard also works in the focused window. Another STT engine can replace it (see below).

App data lives in memory only, so reloading the page gives a clean demo.

## Integrate with Carter's shell

Each app owns its state and logic. The shell creates the window frame and a dedicated content element, then mounts an app by content type:

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
- `variant`: a string or list of style tokens (`[a-z0-9-]`), applied only as `surfaceos-v-*` class names.
- `disabled: true` on a button: drawn dimmed and never activates.
- Elements are reused across renders by widget id. A press in progress survives a re-render while its button still exists and is enabled; it is canceled if the button disappears, becomes disabled, or the layout is for a different window.

Contract version stays **1**. The shell must keep window IDs unique.

## Media bridge

`python tools/media_bridge.py [--port 8766]` listens on `127.0.0.1` only. `GET /media/status` returns the current track; `POST /media/<command>` presses a media key, where the command is `play_pause`, `next`, `previous`, `volume_up`, `volume_down`, or `mute`. POST requests need the `X-SurfaceOS: 1` header, and browser requests are accepted only from `localhost` pages, so other websites cannot trigger media keys. Track info comes from the Windows media session API through a background PowerShell process.
