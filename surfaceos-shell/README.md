# SurfaceOS shell

This is the team repository's browser shell. It owns calibration, surface transforms, window placement and management, and mounts the apps from `frontend/` inside windows. It does not save an environment: reload or reset starts setup again.

## Run on Windows

From this repository, double-click `surfaceos-shell/start_windows.bat`. It serves the repository root and opens `http://localhost:8000/surfaceos-shell/frontend/`. Python 3 and Chrome or Edge are needed. Keep the server window open. Press **Fullscreen** to move the browser to the projector; extend the laptop display and put that browser window on the projector before calibrating.

From a terminal at the repository root:

```bash
python tools/dev_server.py
```

This serves the repository root on port 8000 with browser caching turned off, so edited scripts always load. Plain `python -m http.server 8000` also works, but the browser may then keep an old copy of a script after an edit; reload with Ctrl+Shift+R if the page behaves like an older version.

Open `http://localhost:8000/surfaceos-shell/frontend/?hand=off` for a mouse-only run. The default URL tries to connect to the hand tracker at `ws://localhost:8765`; start it separately with `python src/main.py` after installing the dependencies in `requirements.txt`.

## Mouse walkthrough

1. On every load, drag the four numbered points to the physical boundary of Surface 1. Confirm. Choose **Add another surface** and repeat if a second area fits within the projector beam. Calibrated areas may not overlap in the projector frame.
2. Choose **Finish setup**, then **Continue with mouse**, or **Align hands** when the tracker is running. Hand alignment runs per surface:
   - **Markers (automatic, about 2 seconds):** the projection goes black with a white grid of square markers on the surface. Keep hands off it. The tracker finds the markers in the camera image and reports a fit error in pixels. If it fails, the setup panel explains why (tracker offline, markers missing, only part of the surface visible, poor fit) and offers **Retry this surface** or **Skip hand alignment**.
   - **C:** touch the center C with your index fingertip and hold still for 4 seconds. This measures where the tracker places your fingertip relative to the touch point.
   - **OK:** the colored ring should now sit under your fingertip anywhere on the surface. Hold on OK for 4 seconds to accept, or give a thumbs down to redo the surface. The laptop controls also accept or retry.

   The camera must see the whole surface and the projection clearly. A plain mouse cannot supply camera samples, so mouse testing skips this step.
3. Choose **Make Window**, then drag in a clear area inside one surface. Scroll the program list with the wheel and click **Pinch to confirm** to run the centered app. **Screenshot** works the same way for the capture area.
4. Choose **Manage** in the footer, confirm, pick **Move**, **Resize** or **Change surface**, then click the target window. Drag the window or one of the four resize corners; Change surface shows numbered destinations.
5. Choose **Close**, confirm, pick **Window** or **Surface**, then click the target. Closing a surface asks again and removes its windows.
6. **Menu** reopens Make Window, Screenshot and New Surface. **New Surface** returns to corner setup for more surfaces while keeping the existing ones and their windows.

With hands, every activating gesture is held for 0.5 s and the cursor ring fills while it builds up: one-hand pinch clicks or drags, both hands pinched and still open the main menu (`two_hand_hold`), a peace sign opens Manage (`peace_sign`), a thumbs down opens Close (`thumbs_down`), and an index finger scrolls. After Make Window or Screenshot, draw with a one-hand pinch-drag or by spreading two pinched hands (`two_hand_pinch_start/move/end`). The gesture menus ask Yes/No first; pointing, scrolling and pinch selection do not. The full event list is in `docs/input.md`. Coordinates from the current Python tracker are camera-normalized; the marker calibration maps those points to the projector before dispatching them to the shell.

The workspace shows one calibrated pointer: a 15 px ring following the primary hand, colored by the surface it is over (Surface 1 cyan, 2 amber, 3 pink, 4 lime, gray when off every surface). Each surface label uses the same color. The Python tracker and physical capture request the camera at 1920x1080 and 30 fps; the tracker prints the mode the camera actually delivers. Raw per-hand tracking bubbles are off by default; add `?bubbles=on` to the URL for input debugging (or `&bubbles=on` when another query option is present). Those raw bubbles are camera positions and will not line up with a calibrated surface.

## Capture and AI paths

Screenshot offers **Capture window** or **Capture physical area** when windows exist. A window capture renders its content to a PNG via the browser; some live video, remote content, and cross-origin assets may not render. A physical capture requests the browser camera, temporarily hides projected UI, and rectifies the selected region through the camera alignment. It may need ambient light and camera permission. The browser and Python tracker must see the same camera view; if the operating system does not allow both to open one camera, physical capture cannot run alongside tracking without a shared camera stream. If the desired physical region is occupied by another window, place the resulting screenshot in free space after capture.

Ask AI opens with a thumbs-up (or **Ask AI** in the program picker) and talks to Gemini through `src/main.py`; see `docs/ai.md` and `WIDGETS.md`. Its desk photo comes from the hand tracker's camera, not the browser, with the projection blanked while it is taken. Speech uses the browser's speech recognition and synthesis (Chrome or Edge); the page needs one mouse click before the browser allows the microphone and spoken replies.

## Integration contract

`window.SurfaceOS.dispatchInput(event)` receives the existing version 1 WebSocket events. The shell retains `mountWidgetRenderer(renderer)`, `getState()`, and `reset()`. `getState()` returns surfaces and windows for debugging. A surface has `id`, `number`, four projector corners, its homography, and optional camera homography. A window has `id`, `surface_id`, logical `x/y/width/height`, and `content`. Each surface's window coordinates are 0..1 in its own rectangular workspace; pointer events on widget hosts remain content-local 0..1. The projection matrix warps the entire surface plane, including its apps, and the input path inversely maps camera points to the proper surface.

The hand server speaks the same event names documented in `docs/input.md`. The shell calibrates incoming camera coordinates locally; do not also apply a second projector mapping upstream. `pointer_cancel` releases an active drag. Mouse and hand routes use the same shell state machine. `frontend/shell-adapter.js` still provides the app registry and renderer.

## Checks

Run `npm test --prefix surfaceos-shell` from the repository root for geometry, dwell, and marker layout checks. On a laptop with Edge or Chrome and the packages in `requirements.txt`, run `python tools/integration_smoke.py` for a browser walk through calibration, marker detection on a screenshot of the projected grid, the fingertip and OK holds, app selection, and move. Hardware checks must verify the four projected corners, marker detection by the real camera, the ring under the fingertip at corners and center, camera crop, and optics on the actual surfaces.
