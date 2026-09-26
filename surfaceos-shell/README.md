# SurfaceOS shell

This is the team repository's browser shell. It owns calibration, surface transforms, window placement and management, and mounts the apps from `frontend/` inside windows. It does not save an environment: reload or reset starts setup again.

## Run on Windows

From this repository, double-click `surfaceos-shell/start_windows.bat`. It serves the repository root and opens `http://localhost:8000/surfaceos-shell/frontend/`. Python 3 and Chrome or Edge are needed. Keep the server window open. Press **Fullscreen** to move the browser to the projector; extend the laptop display and put that browser window on the projector before calibrating.

From a terminal at the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/surfaceos-shell/frontend/?hand=off` for a mouse-only run. The default URL tries to connect to the hand tracker at `ws://localhost:8765`; start it separately with `python src/main.py` after installing the dependencies in `requirements.txt`.

## Mouse walkthrough

1. On every load, drag the four numbered points to the physical boundary of Surface 1. Confirm. Choose **Add another surface** and repeat if a second area fits within the projector beam. Calibrated areas may not overlap in the projector frame.
2. Choose **Enter workspace**, then **Continue with mouse**. The hand-alignment route instead asks you to pinch four projected targets per surface with the tracker. A plain mouse cannot supply camera-space samples.
3. Choose **New Window**, then drag in a clear area inside one surface. Scroll the program list with the wheel and click **Pinch to confirm** to run the centered app.
4. Choose **Move / Resize**; confirm, pick an operation, confirm it, then click the target window. Drag the window or one of the four resize corners. With multiple surfaces, Move asks whether to select a numbered destination.
5. Choose **Close**, confirm, then click the target window. The **Actions** button and the three-action menu let you create another window.

The tracker sends `two_hand_single_pinch` to request the main actions, `two_hand_double_pinch` for Move/Resize, and `thumbs_down` for Close. Gesture prompts ask for Yes/No. `two_hand_pinch_start/move/end` draws a new rectangle after an action is selected. Ordinary pointing, one-hand pinch selection, and scrolling do not ask for approval. Coordinates from the current Python tracker are camera-normalized; the optional four-target alignment maps those points to the projector before dispatching them to the shell.

## Capture and AI paths

Screenshot offers **Capture window** or **Capture physical area** when windows exist. A window capture renders its content to a PNG via the browser; some live video, remote content, and cross-origin assets may not render. A physical capture requests the browser camera, temporarily hides projected UI, and rectifies the selected region through the camera alignment. It may need ambient light and camera permission. The browser and Python tracker must see the same camera view; if the operating system does not allow both to open one camera, physical capture cannot run alongside tracking without a shared camera stream. If the desired physical region is occupied by another window, place the resulting screenshot in free space after capture.

Ask AI opens a question window with text, microphone, and camera controls. Speech uses the browser's speech recognition when available. Camera capture attaches a local image through the same physical capture path. **No model endpoint is connected**: Send gives a clear unavailable message and does not invent an answer.

## Integration contract

`window.SurfaceOS.dispatchInput(event)` receives the existing version 1 WebSocket events. The shell retains `mountWidgetRenderer(renderer)`, `getState()`, and `reset()`. `getState()` returns surfaces and windows for debugging. A surface has `id`, `number`, four projector corners, its homography, and optional camera homography. A window has `id`, `surface_id`, logical `x/y/width/height`, and `content`. Each surface's window coordinates are 0..1 in its own rectangular workspace; pointer events on widget hosts remain content-local 0..1. The projection matrix warps the entire surface plane, including its apps, and the input path inversely maps camera points to the proper surface.

The hand server speaks the same event names documented in `docs/input.md`. The shell calibrates incoming camera coordinates locally; do not also apply a second projector mapping upstream. `pointer_cancel` releases an active drag. Mouse and hand routes use the same shell state machine. `frontend/shell-adapter.js` still provides the app registry and renderer.

## Checks

Run `npm test --prefix surfaceos-shell` from the repository root for perspective and overlap geometry checks. On a laptop with Edge or Chrome and the `websockets` Python package, run `python tools/integration_smoke.py` for a browser walk through calibration, synthetic hand alignment, app selection, and move. Hardware checks must verify the four projected corners, center alignment, real hand targets, camera crop, and optics on the actual surfaces.
