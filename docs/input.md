# Hand input: what the browser receives

This describes how the hand-input side implements the Input → browser contract in CLAUDE.md.
Change it only after agreeing with the shell and widget owners.

## Transport

WebSocket at `ws://localhost:8765` (see `config/settings.json`). One JSON message per event:

```json
{ "version": 1, "type": "pointer_move", "x": 0.42, "y": 0.68, "source": "hand" }
```

`x` and `y` are normalized across the full projected canvas, `(0, 0)` top left. Values are clamped to 0-1.

## Event order within one frame

1. `pointer_move` every camera frame while the hand is visible (about 30 per second).
2. `double_pinch`, if this frame's pinch completed a double pinch.
3. `pointer_down` or `pointer_up`, if the pinch state changed.

So the shell always has the position before a press, and hears `double_pinch` before the
`pointer_down` that belongs to it.

## Pinch and double pinch

- One pinch produces one `pointer_down`; releasing produces one `pointer_up`. Holding and moving
  produces only `pointer_move` while pressed.
- `double_pinch` fires when a second pinch starts within `double_pinch.max_interval_s` (0.45 s)
  of the first, and within `double_pinch.max_distance` (0.08 of the camera width) of it.
- The first pinch of a double pinch still produces a normal `pointer_down` / `pointer_up`.
  To avoid unintended widget activations, the shell should not act on a press on the blank canvas
  until the double-pinch window has passed, or should ignore clicks outside widgets. To be agreed.
- The second pinch stays pressed, so the shell can treat its drag as the window's opposite corners.

## Lost tracking

When the hand leaves the camera, one `pointer_cancel` is sent at its last position, whether or not
it was pressed. The shell should abandon any press or drag and hide the cursor. The next
`pointer_move` means the hand is back.

## One pointer

The contract carries a single pointer. With two hands visible, the first hand to appear drives it
until it leaves the camera. A replacement hand is only chosen while it is not pinching, so the shell
never sees a press without a `pointer_down`. Multi-pointer support would need a contract change
(for example an optional `pointer_id`).

## Debug hand snapshot

When `debug.hand_bubbles` is `true` in `config/settings.json`, every frame also sends one snapshot of
all tracked hands, including hands that are not the primary pointer:

```json
{ "version": 1, "type": "hand_debug", "hands": [ { "id": 0, "x": 0.42, "y": 0.68, "pinching": true, "primary": true } ] }
```

Positions are the same clamped canvas values that hand's pointer events carry. An empty `hands` list
means no hand is tracked. The browser shows these as temporary bubbles and never treats them as
input; set the flag to `false` for the demo.

## Testing without a camera

- `python tools/fake_pointer_stream.py` plays a scripted loop: wandering, a click, a double pinch
  with a drag, and a cancelled drag.
- `tools/pointer_viewer.html` shows and validates whatever is being sent.
