# Hand input: what the browser receives

This describes how the hand-input side implements the Input → browser contract in CLAUDE.md.
Change it only after agreeing with the shell and widget owners.

## Transport

WebSocket at `ws://localhost:8765` (see `config/settings.json`). One JSON message per event:

```json
{ "version": 1, "type": "pointer_move", "x": 0.42, "y": 0.68, "source": "hand" }
```

`x` and `y` are currently normalized camera-frame coordinates, `(0, 0)` top left, with the optional horizontal mirror in `src/calibration/coordinate_mapper.py`. Values are clamped to 0-1. During SurfaceOS setup, the tracker measures each surface from projected markers (see "Calibration" below) and the shell uses that result to map these incoming coordinates into the projector frame. Do not apply another projector homography upstream unless the shell and tracker are changed together.

## Calibration (browser to tracker and back)

This is the only message the browser sends. The shell projects a grid of ArUco `DICT_4X4_50`
markers (ids 0-11, drawn by `surfaceos-shell/frontend/scripts/markers.js`) inside one surface,
waits about 0.6 s, then sends:

```json
{ "version": 1, "type": "calibration_request", "surface_id": "surface-1",
  "markers": [ { "id": 0, "corners": [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]] } ] }
```

`corners` are the marker's outer corners in surface-local 0-1 coordinates, clockwise from top left.
The tracker ignores frames for 0.3 s, collects detections for 1.5 s, fits a homography with outlier
rejection (`src/calibration/marker_calibration.py`), and answers:

```json
{ "version": 1, "type": "calibration_result", "surface_id": "surface-1", "ok": true,
  "camera": [9 numbers], "error_px": 0.8, "markers_found": 12, "markers_expected": 12 }
```

`camera` is a row-major 3x3 homography, last value 1, from surface-local `(u, v)` to the same camera
coordinates that pointer events carry (mirror included). `error_px` is the median fit error in camera
pixels. On failure `ok` is `false`, `camera` is absent, and `reason` is a sentence for the user.
A request is rejected when fewer than 4 markers are found, the found markers cover less than half the
grid in either direction, or the error exceeds 4 px. A new request replaces one in progress.

After a successful result the shell asks for one fingertip hold on the surface center and stores the
difference between the held fingertip and the calibrated center as a per-surface offset in camera
coordinates. That offset corrects for where MediaPipe places the fingertip relative to the touch point.

## Gestures

Every activating gesture must be held for `gestures.hold_s` (0.5 s in `config/settings.json`).

| Gesture | Event | Shell response |
| --- | --- | --- |
| One-hand pinch held 0.5 s | `pointer_down`, then `pointer_up` on release | Click; keep pinching to drag. A shorter pinch sends nothing. |
| Thumbs down held 0.5 s | `thumbs_down` with `x`, `y` | Yes/No, then **Window / Surface**, then pick the target. |
| Peace sign held 0.5 s | `peace_sign` with `x`, `y` | Yes/No, then **Move / Resize / Change surface**, then pick the window. |
| Index finger pointing | `scroll` with `dy` while held, with a short coast after a flick | Scrolls lists and window content. |
| Both hands pinched and still for 0.5 s | `two_hand_hold` with `x`, `y` | Yes/No, then **Make Window / Screenshot / New Surface**. |
| Both hands pinched, then spread | `two_hand_pinch_start`, `_move`, `_end` with `x`, `y`, `width`, `height` | Draws the area after Make Window or Screenshot. `two_hand_pinch_cancel` if a hand is lost. |

While any hold is building up, the tracker sends the progress of the one closest to firing, so the
cursor ring can fill. It is sent only when the value changes, and returns to 0 when a hold fires or stops:

```json
{ "version": 1, "type": "hold_progress", "progress": 0.6, "source": "hand" }
```

The static poses come from MediaPipe's gesture recognizer (`Thumb_Down`, `Victory`); a pose must be
stable for `static_gestures.stable_frames` frames before its 0.5 s hold starts. Thumbs up is reserved
for Ask AI and is not sent yet. `two_hand_single_pinch`, `two_hand_double_pinch` and the one-hand
`double_pinch` are no longer sent.

## Event order within one frame

1. `pointer_move` every camera frame while the hand is visible (about 30 per second).
2. `scroll`, then `pointer_down` or `pointer_up`, for each hand.
3. `thumbs_down` or `peace_sign`, then any `two_hand_*` event.
4. `hold_progress`, if it changed.

The shell receives pointer position before a one-hand press. Two-hand gesture events
are separate from widget presses.

## Pinch details

- A pinch held 0.5 s produces one `pointer_down`; releasing produces one `pointer_up`. Holding and
  moving produces only `pointer_move` while pressed.
- When a second hand starts pinching, any press by the first hand is cancelled so a two-hand gesture
  never clicks a widget. Hands in a two-hand gesture press again only after releasing their pinch.
- One-hand `pointer_down` / `pointer_up` confirms the centered program picker item or
  selects controls and widgets. A gesture recognition event does not trigger an extra widget click.

## Lost tracking

When the hand leaves the camera, one `pointer_cancel` is sent at its last position, whether or not
it was pressed. The shell should abandon any press or drag and hide the cursor. The next
`pointer_move` means the hand is back.

## One pointer

The pointer contract carries a single pointer. With two hands visible, the first hand to appear drives it
until it leaves the camera. A replacement hand is only chosen while it is not pinching, so the shell
never sees a press without a `pointer_down`. Multi-pointer support would need a contract change
(for example an optional `pointer_id`).

## Debug hand snapshot

When `debug.hand_bubbles` is `true` in `config/settings.json`, every frame also sends one snapshot of
all tracked hands, including hands that are not the primary pointer:

```json
{ "version": 1, "type": "hand_debug", "hands": [ { "id": 0, "x": 0.42, "y": 0.68, "pinching": true, "primary": true } ] }
```

Positions are the same clamped camera-frame values that hand's pointer events carry. An empty `hands` list
means no hand is tracked. The browser shows these as temporary bubbles and never treats them as
input; set the flag to `false` for the demo.

## Testing without a camera

- `python tools/fake_pointer_stream.py` plays a scripted tracker event loop; its sequence may need
  updating for the calibration-first shell. Use `python tools/integration_smoke.py` for the current
  mouse setup and interaction path in an installed Chrome or Edge browser.
- `tools/pointer_viewer.html` shows and validates whatever is being sent.
