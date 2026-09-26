# Hand input: what the browser receives

This describes how the hand-input side implements the Input → browser contract in CLAUDE.md.
Change it only after agreeing with the shell and widget owners.

## Transport

WebSocket at `ws://localhost:8765` (see `config/settings.json`). One JSON message per event:

```json
{ "version": 1, "type": "pointer_move", "x": 0.42, "y": 0.68, "source": "hand" }
```

`x` and `y` are currently normalized camera-frame coordinates, `(0, 0)` top left, with the optional horizontal mirror in `src/calibration/coordinate_mapper.py`. Values are clamped to 0-1. During SurfaceOS setup, the shell records four hand-target samples per projected surface and maps these incoming coordinates into the projector frame. Do not apply another projector homography upstream unless the shell and tracker are changed together.

## Event order within one frame

1. `pointer_move` every camera frame while the hand is visible (about 30 per second).
2. A `two_hand_*` event if the two-hand gesture state changed.
3. `pointer_down` or `pointer_up`, if the one-hand pinch state changed.

The shell receives pointer position before a one-hand press. Two-hand gesture events
are separate from widget presses.

## Pinch and double pinch

- One pinch produces one `pointer_down`; releasing produces one `pointer_up`. Holding and moving
  produces only `pointer_move` while pressed.
- A one-hand `double_pinch` event is no longer sent. Two-hand single and double pinches
  open the main actions and management prompts. A two-hand pinch start/move/end sequence
  carries the rectangle used to draw a window after an action has been chosen.
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
