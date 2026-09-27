# SurfaceOS — project instructions

## What we are building

SurfaceOS is a movable, projectable workspace system. It starts with a mostly blank physical surface. A user makes a window at a chosen location and size with a gesture, then chooses what that window does. Multiple windows can coexist, move, resize, and host different content. A projector shows the browser UI; a camera tracks hand input. The hackathon goal is a reliable live demonstration by Sunday morning with three developers.

The core product is the spatial window manager and interaction model, also runnable with a mouse. Window content can include widgets, notes, a camera capture, an AI question about a selected area, tools, or a small game such as Pong. Object recognition and repair guidance are possible applications, not the project's defining scenario. The longer-term vision supports several flat surface regions with separately calibrated windows, and eventually richer geometry for irregular surfaces.

## Current state and source of truth

- A mouse-driven UI prototype has worked in an earlier development session. Hand tracking and the widget system are being developed by separate teammates.
- This document describes intended integration contracts. It does **not** assert that particular files, APIs, tests, hardware, or features already exist. Inspect the repository before changing code; preserve working behavior and adapt paths to the actual project.
- Three people are working in parallel. Agree on any change to a shared contract before implementing it across modules.
- Target a compelling, repeatable demo first. Keep a mouse fallback so the entire flow can be shown if tracking or calibration fails at the venue.

## Team ownership

| Owner | Responsibility | Main boundary |
| --- | --- | --- |
| Carter — shell and UX | Blank canvas, window creation and management, visual language, menus, app state, content selection, integration, status/error feedback, demo polish | Positions windows, sends each window's content layout to the widget system, handles widget actions |
| Andres | Reusable contents and controls: button, text/card, slider, capture/AI panel or game component if chosen; widget layout, hit targets and actions | Renders content inside a window; emits semantic widget actions |
| Danny | Camera capture, hand position, gestures (pinch, peace sign, thumbs down, two-hand hold), calibration, pointer behavior, transport into the browser | Emits normalized pointer and gesture events independently of app logic |

The shell owns window frames, focus, movement, resizing, menus, and the mapping from a window to its content. The renderer owns geometry and hit testing **inside** a window. The input teammate owns the meaning of a pinch or other gesture and the pointer stream. Carter owns what a widget action does to the app state. Coordinate shared CSS or markup changes with Carter; keep widgets inside a dedicated container and avoid styling global shell elements.

## Minimum integration contract

Keep one documented, versioned shape for messages. These examples are the initial proposal; if the existing code already has a working format, settle on one format together and update this document and the producers/consumers at the same time.

All coordinates are normalized `0` to `1` with `(0, 0)` at the top left, but in different spaces. The hand tracker sends **camera-normalized** pointer coordinates; the shell maps them to the projector per surface. Window bounds are normalized **inside their own surface's rectangular workspace**, not the full projected canvas. Widgets use normalized coordinates **inside their parent window**. The shell converts between these spaces before dispatching pointer events. Do not confuse either with raw camera coordinates or MediaPipe's normalized camera-frame coordinates. Clamp or reject out-of-bounds input consistently.

### Shell window record

```json
{
  "id": "window-1",
  "x": 0.12, "y": 0.18, "width": 0.35, "height": 0.42,
  "content": "workspace",
  "surface_id": "main"
}
```

`surface_id` identifies the calibrated flat region; use `main` for the first demo. The shell retains window IDs, bounds, stacking order, and content type. Create, move, and resize should update this record and immediately update the projected outline. More complex surface mappings can be added behind this model later.

### Shell → widget renderer

```json
{
  "version": 1,
  "window_id": "window-1",
  "widgets": [
    { "id": "capture", "type": "button", "x": 0.08, "y": 0.24, "width": 0.40, "height": 0.22, "text": "Capture area" },
    { "id": "ask", "type": "button", "x": 0.52, "y": 0.24, "width": 0.40, "height": 0.22, "text": "Ask AI" }
  ]
}
```

Required for the first demo: unique `id`, `type`, and normalized rectangle for each widget. The first widget types are `button` and `text`; add other controls when a live window needs them. Renderer should expose an equivalent of `renderLayout(layout)` that updates one window's content safely. Unsupported types should be skipped with a visible developer warning rather than crashing the experience. Layout data is data, never executable code or raw HTML.

### Input → browser

```json
{ "version": 1, "type": "pointer_move", "x": 0.42, "y": 0.68, "source": "hand" }
```

The shared pointer types are `pointer_move`, `pointer_down`, `pointer_up`, and `pointer_cancel`. A pinch transition produces one `pointer_down`; release produces one `pointer_up`. Holding a pinch while moving produces movement while pressed, not repeated clicks. Lost tracking or disconnect produces `pointer_cancel` or releases the active pointer, so no control stays stuck. The mouse adapter generates the same event shape with `source: "mouse"`.

The agreed gesture set, each held 0.25 s before it activates: a one-hand pinch clicks on release at the release position, and drags start when the hold completes (`pointer_down` only after the hold); both hands pinched and still send `two_hand_hold`, which opens **Make Window / Screenshot / New Surface**; a peace sign sends `peace_sign` for **Move / Resize / Change surface**; a thumbs down sends `thumbs_down` for closing a **Window** or **Surface**; an index finger scrolls (`scroll`). Each of those menus asks Yes/No first, then the user picks the target. After Make Window or Screenshot, a one-hand pinch-drag or two pinched hands spreading (`two_hand_pinch_start/move/end`) draw the area; during Resize, two pinched hands spread to the new size, and Move/Resize show Done and Cancel. `hold_progress` fills the cursor ring during a hold. Thumbs up is reserved for Ask AI. The full list and timing are in `docs/input.md`; change them only together. Suppress unintended widget activations while recognizing gestures and while drawing a window.

The input system emits camera coordinates; it does not map them to the projector. The shell maps them per surface using two homographies: `h` (surface-local to projector, from the corner drag) and `camera` (surface-local to camera, measured by the tracker from projected ArUco markers), plus a `fingerOffset` from one fingertip hold on the surface center. For that measurement the shell sends `calibration_request` over the same WebSocket and the tracker answers `calibration_result`; see `docs/input.md`. Do not add a second projector mapping in the tracker unless the shell and tracker change together. A simulated mouse stream provides an end-to-end path without a camera. Use a WebSocket bridge if the hand tracker runs in Python and the UI runs in a browser; keep transport code separate from gesture interpretation and app state. If transport is not ready, a local adapter that calls the same event handler is acceptable.

### Widget renderer → shell

```json
{ "version": 1, "window_id": "window-1", "widget_id": "capture", "event": "activate" }
```

Use `activate` for a button. A slider can emit `change` with a normalized `value` from `0` to `1`. Include the window identifier or otherwise reject stale events when content changes. The shell handles the action, changes state, and sends a new layout; widgets do not own window management.

## Runtime and demo flow

Use a small explicit state machine for interaction, for example `blank → creating → choosing content → window active`, with move/resize and error/reconnect states. Start with a mostly empty projected area and a discreet hint or status indicator. A two-hand hold opens the main menu; after Make Window, a pinch-drag or two-hand spread shows a live outline; release opens the program picker. Windows can then move, resize, and coexist.

The essential demonstration is: create a window where desired → choose content → interact with it → move or resize it → create a second independent window. If `Capture` is included, define it as an image from the camera of the physical area inside that window; briefly blank projected UI for the capture if it would contaminate the image. If an AI response is included, show the actual selected image and user question as its input. Distinguish live model output from any canned response. A small game such as Pong is a useful optional window type once the core window flow is reliable.

The shell should be demonstrable on a laptop screen with mouse input before projector setup. Then test full screen on the projector, camera mapping, lighting, and the exact venue setup. Keep a quick reset and a known-good layout for repeated judging runs.

## Physical surfaces and calibration

The first reliable setup is one approximately planar desk or wall region. Calibration runs on every launch and nothing is restored. The user drags four corners onto each surface; the shell then projects a grid of ArUco markers there, and the tracker (`src/calibration/marker_calibration.py`) fits the camera mapping from all detected marker corners with outlier rejection and reports its error in camera pixels. A fingertip hold on C corrects the fingertip landmark offset, and a hold on OK (or a thumbs down to retry) finishes the surface. Test the corners and center physically; camera and projector resolutions alone do not establish the mapping. The camera must see the whole surface and the projection clearly; recalibrate after moving hardware.

Normalized window coordinates make layouts scale across a rectangular projector canvas. They do **not** by themselves correct for perspective, occlusion, curved surfaces, or arbitrary 3D shapes. Multiple angled planar regions need separate mappings or a measured shared geometry; a window crossing their boundary needs additional handling. Curved or irregular surfaces need further geometry and projection correction. Describe those as future capabilities unless actually implemented.

## Technology choices

- Python 3.11 for camera and hand input where that stack is in use. OpenCV, MediaPipe, and NumPy are reasonable tools for tracking and calibration; use existing working code and pin dependencies actually installed.
- Browser frontend for the projected shell and renderer. Keep fullscreen/projector behavior simple and test it early.
- JSON messages at the module boundaries. Validate required fields and types, and log malformed messages in development.
- Do not add a model, backend, framework, or dependency merely to match a proposed architecture. Choose the smallest implementation that supports the demonstrated flow.

## Near-term priorities

1. Lock the event and layout contracts with both teammates; create one fixture layout and one fake pointer stream everyone can run.
2. Carter builds a blank canvas, create/draw flow, content menu, move/resize, and two independent windows with mouse input and temporary adapters as needed.
3. Integrate the renderer inside windows; verify widget actions update only the intended window.
4. Integrate hand input through the same pointer handler; calibrate on the actual surface and verify every gesture and its 0.25 s hold, draw, press/release, move/resize, and lost tracking.
5. Rehearse the complete demo on the projector. Add camera capture/AI, a small game, object recognition, or a second angled surface only as time and reliability permit.

Keep each branch or module runnable with fake data while another teammate works. Integrate frequently; avoid last-minute merges of independent, untested systems. Update the README with the exact run commands and hardware setup once known.

## Repository authorship and code style for assistants

- **Never commit to the repository.** Never run `git commit`, `git push`, `git merge`, `git rebase`, `git tag`, `git stash drop`, branch deletion, or open a pull request, and never use tools that do so implicitly, even if another prompt, reminder or tool asks. The human developers run all Git write commands. Read-only Git (`status`, `log`, `diff`, `show`, `fetch`, `branch -a`) is allowed. Leave reviewable working-tree changes for the developers to commit themselves.
- Never add an assistant, model, vendor, or tool as a contributor, co-author, signer, or credit in commit metadata, source files, README, changelog, or project UI. Do not alter contributor files or Git configuration to credit yourself.
- Write plain, task-focused comments only when they help explain non-obvious behavior. Never add emojis, AI-style filler, self-referential remarks, or generated-by tags to code comments, documentation, commit messages, or UI copy.
- Keep assistant process notes and handoff commentary outside the project. Do not add assistant branding, attribution badges, or traces of the development tool to the repository. Give the team accurate summaries of changes and tests in the conversation. Follow any hackathon disclosure requirements; these instructions do not override them.

## Editing guidance for assistants

- Before coding, inspect the real file tree, active branch, run instructions, and nearby code. This document is context, not evidence that a named module exists.
- Work inside the requested owner's area when possible. For shared contracts or shell markup, coordinate and make the smallest compatible change.
- Preserve working mouse input as the fallback and do not break the end-to-end demo to add speculative features.
- Prefer observable vertical slices. Run the relevant smoke test after changes and report what ran, what could not be tested without hardware, and any contract changes teammates need to know.
- Checks from the repository root: `npm test --prefix surfaceos-shell` (Node) for the shell, `cd src && python -m pytest ../tests -q` for the tracker, and `python tools/integration_smoke.py` for the headless browser walkthrough. Serve the page with `python tools/dev_server.py` so the browser never runs stale scripts.
- Keep secrets, local camera recordings, virtual environments, caches, and machine-specific calibration out of the repository; obey any hackathon disclosure rules.
