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
| Danny | Camera capture, hand position, gestures including double pinch, calibration, pointer behavior, transport into the browser | Emits normalized pointer and gesture events independently of app logic |

The shell owns window frames, focus, movement, resizing, menus, and the mapping from a window to its content. The renderer owns geometry and hit testing **inside** a window. The input teammate owns the meaning of a pinch or other gesture and the pointer stream. Carter owns what a widget action does to the app state. Coordinate shared CSS or markup changes with Carter; keep widgets inside a dedicated container and avoid styling global shell elements.

## Minimum integration contract

Keep one documented, versioned shape for messages. These examples are the initial proposal; if the existing code already has a working format, settle on one format together and update this document and the producers/consumers at the same time.

Window bounds and browser pointer events use normalized coordinates across the **full projected canvas**: `x` and `y` run from `0` to `1`, with `(0, 0)` at the top left. Widgets use normalized coordinates **inside their parent window**. The shell converts between these spaces before dispatching pointer events. Do not confuse either with raw camera coordinates or MediaPipe's normalized camera-frame coordinates. Clamp or reject out-of-bounds input consistently.

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

The input teammate should also emit a distinct `double_pinch` gesture event with a position. The shell interprets this as entering window-creation mode when appropriate. The following pinch-drag defines opposite corners of a new window; release opens a compact content menu. A mouse double click followed by drag can exercise the same path. Suppress unintended widget activations while recognizing the double pinch and while drawing a window. The exact gesture timing and cancellation behavior should be agreed and tested together.

The input system maps camera points to the projected workspace before emitting these events. Until calibration is ready, a simulated mouse stream provides an end-to-end path. Use a WebSocket bridge if the hand tracker runs in Python and the UI runs in a browser; keep transport code separate from gesture interpretation and app state. If transport is not ready, a local adapter that calls the same event handler is acceptable.

### Widget renderer → shell

```json
{ "version": 1, "window_id": "window-1", "widget_id": "capture", "event": "activate" }
```

Use `activate` for a button. A slider can emit `change` with a normalized `value` from `0` to `1`. Include the window identifier or otherwise reject stale events when content changes. The shell handles the action, changes state, and sends a new layout; widgets do not own window management.

## Runtime and demo flow

Use a small explicit state machine for interaction, for example `blank → creating → choosing content → window active`, with move/resize and error/reconnect states. Start with a mostly empty projected area and a discreet hint or status indicator. A double pinch enters creation; a pinch-drag shows a live outline; release offers `Workspace`, `Capture`, and `Ask AI` if those features are actually implemented. Windows can then move, resize, and coexist.

The essential demonstration is: create a window where desired → choose content → interact with it → move or resize it → create a second independent window. If `Capture` is included, define it as an image from the camera of the physical area inside that window; briefly blank projected UI for the capture if it would contaminate the image. If an AI response is included, show the actual selected image and user question as its input. Distinguish live model output from any canned response. A small game such as Pong is a useful optional window type once the core window flow is reliable.

The shell should be demonstrable on a laptop screen with mouse input before projector setup. Then test full screen on the projector, camera mapping, lighting, and the exact venue setup. Keep a quick reset and a known-good layout for repeated judging runs.

## Physical surfaces and calibration

The first reliable setup is one approximately planar desk or wall region. A four-point homography can map camera points on that plane into the rectangular projected workspace. Test the corners and center physically; camera and projector resolutions alone do not establish the mapping. Store calibration separately from hand tracking and allow recalibration after moving hardware.

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
4. Integrate hand input through the same pointer handler; calibrate on the actual surface and verify double pinch, draw, press/release, move/resize, and lost tracking.
5. Rehearse the complete demo on the projector. Add camera capture/AI, a small game, object recognition, or a second angled surface only as time and reliability permit.

Keep each branch or module runnable with fake data while another teammate works. Integrate frequently; avoid last-minute merges of independent, untested systems. Update the README with the exact run commands and hardware setup once known.

## Repository authorship and code style for assistants

- Do not make Git commits or push changes directly to the repository. Leave changes in the working tree for a human teammate to review and commit. Do not create a branch or open a pull request unless explicitly requested.
- If a teammate explicitly instructs you to make a commit, use the existing human Git author identity. Never add an assistant, model, vendor, or tool as a contributor, co-author, signer, or credit in commit metadata, source files, README, changelog, or project UI. Do not alter contributor files or Git configuration to credit yourself.
- Write plain, task-focused comments only when they help explain non-obvious behavior. Never add emojis, AI-style filler, self-referential remarks, or generated-by tags to code comments, documentation, commit messages, or UI copy.
- Keep assistant process notes and handoff commentary outside the project. Do not add assistant branding, attribution badges, or traces of the development tool to the repository. Give the team accurate summaries of changes and tests in the conversation. Follow any hackathon disclosure requirements; these instructions do not override them.

## Editing guidance for assistants

- Before coding, inspect the real file tree, active branch, run instructions, and nearby code. This document is context, not evidence that a named module exists.
- Work inside the requested owner's area when possible. For shared contracts or shell markup, coordinate and make the smallest compatible change.
- Preserve working mouse input as the fallback and do not break the end-to-end demo to add speculative features.
- Prefer observable vertical slices. Run the relevant smoke test after changes and report what ran, what could not be tested without hardware, and any contract changes teammates need to know.
- Keep secrets, local camera recordings, virtual environments, caches, and machine-specific calibration out of commits. Preserve existing Git author identity when a human explicitly requests a commit; obey any hackathon disclosure rules.
