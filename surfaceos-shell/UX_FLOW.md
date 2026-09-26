# SurfaceOS interaction flow — agreed direction

This document defines the intended user experience. The browser shell now implements its core states. Camera capture and projector optics still require hardware verification, and Ask AI needs a model service before it can answer.

## Terms

- **Surface:** a calibrated physical work area inside one projector's field. Surfaces are numbered at setup and may have different angles. A new placement means a new calibration; there is no saved surface profile.
- **Window:** a movable, resizable container for a program, a screenshot, or Ask AI. Windows do not overlap. A window belongs to one surface at a time.
- **Pointer:** the index-finger-controlled cursor, with mouse fallback during development.

## Startup

1. On every launch, show calibration before any windows.
2. Mark the usable boundary of Surface 1. Calibrate the flat region's projected geometry, then point an index fingertip at each numbered target and hold still for 3 seconds without pinching. Show a filling progress ring; reset it if the hand moves or tracking stops. Require the finger to leave a completed point before holding at the next target. Check the cursor at the projected center and retry that surface if it is off.
3. Ask whether to add another surface. Repeat boundary calibration and number each surface until the user finishes. All demo surfaces use the same projector and are positioned within its illumination and usable focus range.
4. Enter a nearly blank environment. Show the three main actions: **New Window**, **Screenshot**, **Ask AI**.
5. Nothing from a previous session, including windows and notes, is automatically restored.

## Creating a window

1. Choose one of the three main actions **before** drawing.
2. Define the new window area by moving both hands apart while pinching, then release. The mouse test adapter can click and drag to stand in for this step. Show the outline continuously.
3. Reject or constrain placement that crosses a surface boundary or overlaps another window. Explain the constraint visibly instead of silently losing the action.
4. The resulting window stays on its chosen surface until explicitly moved.

### New Window

Inside the drawn window, display a scrollable program picker. The index finger scrolls or flicks without a confirmation prompt. The centered item is shown as `> selection <`, with a short **Pinch to confirm** hint. A one-hand pinch launches that item. Program types and their rendering are supplied by the widget/app teammate; the shell owns the window frame and chosen content identity.

### Screenshot

- If there are no windows, go directly to **Capture physical area**.
- If windows exist, offer **Capture window** or **Capture physical area**.
- **Capture window:** select a source window with one click, then capture its digital content directly. This gives a sharp image without photographing the projection.
- **Capture physical area:** temporarily hide projected windows and controls, capture the selected real-world region with the camera, and restore the windows. Temporary hiding does not delete or reset them. Camera-to-surface calibration is required for an accurate crop. If darkness makes capture unusable, the capture step needs appropriate neutral illumination or ambient light.
- Show the result in a new screenshot window. If the chosen result placement conflicts with existing windows, ask for another free position.

The Ask AI camera action should reuse the physical-area capture path rather than inventing a second camera workflow.

### Ask AI

The drawn window contains an AI conversation area with a microphone action for a spoken question and a camera action to capture and send an image. Its real answer must reflect the actual voice question or selected image. Permission prompts and unavailable hardware need clear feedback.

## Returning to actions and managing windows

| Trigger | Shell response |
| --- | --- |
| Two-hand single pinch | Reopen the three main actions. |
| Two-hand double pinch | Offer Move and Resize modes. |
| Move or Resize chosen | Ask for confirmation, then select a target window with one click. |
| Move on current surface | Drag the selected window; prevent overlap and boundary crossing. |
| Move to another surface | Ask whether to move to a new surface; show large numbered labels on calibrated surfaces; select a destination number, place the window there, and prevent overlap. |
| Resize | Expose draggable controls on the selected window's four corners; keep it within its surface and free of overlap. |
| Thumbs down | Offer to close a window; after confirmation, select its target with one click. |
| Index-finger point and flick | Scroll lists or window content without an approval prompt. |

Gesture-triggered mode changes and actions show a short **Do you want to …?** confirmation with Yes and No, except for ordinary pointing and scrolling. Confirmation should happen once before a move or resize interaction, rather than after every motion frame. The initial three-action choice is direct. A one-hand pinch confirms the centered program-picker item.

## Mouse testing equivalents

The shell should remain fully testable without a camera. Clicks can select actions, targets, numbered surfaces, and Yes/No. Click-drag stands in for two-hand window definition, moving, and corner resizing; the mouse wheel stands in for pointer-finger scrolling. The screen should label these temporary testing controls without making them the projected product's primary visual language.

## Implementation boundaries and unresolved technical details

- The shell now implements calibration-first setup, action-before-draw, per-surface perspective transforms, camera-target alignment, and the window management states. Digital screenshot rendering and browser camera capture have implementation paths but still require browser and hardware validation. No AI model endpoint is connected.
- The shell consumes the existing version 1 two-hand and pointer event names. Hand gesture recognition belongs to input; the shell decides actions and target selection; widgets render inside windows. Camera points are transformed by the shell after the guided four-target alignment, so the tracker must not also warp them.
- Precise physical screenshots require mapping camera pixels to each calibrated surface. Projector correction and camera input mapping are related, but they are distinct transformations.
- A reliable nonoverlap policy should be tested on each surface's logical coordinates, including after moving or resizing. The user-facing result should stay predictable when a proposed placement is invalid.
