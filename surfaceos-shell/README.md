# SurfaceOS shell starter

Carter's part of the three-person SurfaceOS project: the projected browser shell, blank canvas, window creation, focus, movement, resizing, content choice, and app state. The hand tracker and widget renderer can plug into it through the adapters below. This is a standalone starter because the existing repository was not available in this workspace.

The agreed startup and gesture sequence is in [UX_FLOW.md](UX_FLOW.md). This mouse prototype predates that agreement: it starts after calibration and currently draws before choosing content. Use it to test window mechanics, not as the final product flow.

## Run

On Windows, double-click `start_windows.bat`. It serves the repository root and opens the shell in your browser. Python 3 must be installed. Keep the server window open while testing.

Or, from the repository root on any system with Python 3:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/surfaceos-shell/frontend/` on the laptop or projector. The page loads the widget renderer and apps from the repository's `frontend/` folder, so it must be served from the repository root. For hand input, run `python src/main.py` (camera) or `python tools/fake_pointer_stream.py` (scripted); the footer shows `Hand · connected`. `?hand=off` disables the hand connection and `?hand=ws://host:port` points it elsewhere. While `debug.hand_bubbles` is `true` in `config/settings.json`, a labelled bubble follows each tracked hand at the exact position used for hit testing and fills in while pinching; set it to `false` for the demo, or add `?bubbles=off` to hide them in one browser. A hand pinch clicks shell buttons (Create a window, New window, Demo layout, Reset, fullscreen) on release over the same button. No npm install is required. Press **F** or the fullscreen icon to project fullscreen. Because the scripts are ES modules, opening `index.html` directly from the ZIP or as a `file://` URL is not the supported run path.

## Mouse demo

1. Double-click empty space, then drag a rectangle; or press **N** / **New window** and drag.
2. Choose **Workspace** or **Notes**.
3. Drag the window's top bar to move, or drag the bottom-right corner to resize.
4. Add a second window. The notes are independently editable during this session. Refreshing starts a new blank session.
5. **Demo layout** loads two sample windows; **Reset** clears the current windows after confirmation. **Esc** cancels drawing or content selection.

## Integration contract (v1)

All outer coordinates are normalized to the **full projected canvas** (`0..1`), origin at top left. `surface_id` is currently `main`. The calibration layer must convert camera coordinates into this projected coordinate space; it should not send raw MediaPipe coordinates here.

The input teammate can call:

```js
window.SurfaceOS.dispatchInput({ version: 1, type: 'double_pinch', x: 0.4, y: 0.4, source: 'hand' });
window.SurfaceOS.dispatchInput({ version: 1, type: 'pointer_down', x: 0.2, y: 0.3, source: 'hand' });
window.SurfaceOS.dispatchInput({ version: 1, type: 'pointer_move', x: 0.6, y: 0.7, source: 'hand' });
window.SurfaceOS.dispatchInput({ version: 1, type: 'pointer_up', x: 0.6, y: 0.7, source: 'hand' });
```

`pointer_cancel` releases a drag when tracking is lost. The source adapter emits one `pointer_down` per pinch and one `pointer_up` on release; it must not send repeated downs while held. Send events to `dispatchInput` from the WebSocket bridge when it exists. The mouse uses that same handler already. Hand interactions with a window's content dispatch `surfaceos:window-pointer` on `.widget-host`, with `window_id`, `type`, and coordinates normalized **inside that content area**. The fallback workspace button is hand clickable. Native text entry in Notes currently requires a keyboard.

The widget teammate can register a renderer:

```js
window.SurfaceOS.mountWidgetRenderer({
  renderLayout(layout, host, onAction) {
    // Render layout.widgets safely inside host, without changing shell styles.
    // Send e.g. onAction({version: 1, window_id: layout.window_id,
    //   widget_id: 'notes', event: 'activate'}).
  },
});
```

The starter renders its own simple workspace card until a renderer mounts. `window.SurfaceOS.getState()` returns the current mode and shell window records. Window content and notes live only in memory; a new run begins blank. If the team already has a working message shape, agree on the v1 shape together before changing either producer or consumer.

## Scope for this slice

The intended full startup flow is: calibrate a surface, add any other surfaces within the same projector's field, then enter a blank workspace. Calibrate again on every launch or after moving the device. This shell prototype begins after that setup stage; it does not yet draw corrected pixels onto separately angled surfaces. Its `surface_id` field leaves room for that integration after the surface calibration contract is agreed. The browser UI can be exercised without the projector, camera, backend, or widget renderer. No capture or AI menu item is shown until those actions work end to end.
