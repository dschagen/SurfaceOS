# SurfaceOS interaction flow — agreed direction

This document defines the intended user experience. The browser shell now implements its core states. Camera capture and projector optics still require hardware verification, and Ask AI needs a model service before it can answer.

## Terms

- **Surface:** a calibrated physical work area inside one projector's field. Surfaces are numbered at setup and may have different angles. A new placement means a new calibration; there is no saved surface profile.
- **Window:** a movable, resizable container for a program, a screenshot, or Ask AI. Windows do not overlap. A window belongs to one surface at a time.
- **Pointer:** the index-finger-controlled cursor, with mouse fallback during development.

## Startup

1. On every launch, show calibration before any windows.
2. Mark the usable boundary of Surface 1. Calibrate the flat region's projected geometry. Then project a marker grid on the surface so the camera can measure it automatically, and explain any failure with Retry and Skip. Next, the user touches the center C and holds still for 4 seconds to correct the fingertip position; a filling progress ring resets if the hand moves or tracking stops. Finally, the calibrated cursor should follow the fingertip: holding on OK for 4 seconds accepts the surface, and a thumbs down retries it.
3. Ask whether to add another surface. Repeat boundary calibration and number each surface until the user finishes. All demo surfaces use the same projector and are positioned within its illumination and usable focus range.
4. Enter a nearly blank environment. Show the three main actions: **Make Window**, **Screenshot**, **New Surface**.
5. Nothing from a previous session, including windows and notes, is automatically restored.

## Creating a window

1. Choose **Make Window** or **Screenshot** **before** drawing.
2. Define the area by pinching with both hands and moving them apart, or by pinching with one hand (held 0.5 s) and dragging, then release. The mouse can click and drag instead. Show the outline continuously.
3. Reject or constrain placement that crosses a surface boundary or overlaps another window. Explain the constraint visibly instead of silently losing the action.
4. The resulting window stays on its chosen surface until explicitly moved.

### Make Window

Inside the drawn window, display a scrollable program picker. The index finger scrolls or flicks without a confirmation prompt. The centered item is shown as `> selection <`, with a short **Pinch to confirm** hint. A one-hand pinch launches that item. Program types and their rendering are supplied by the widget/app teammate; the shell owns the window frame and chosen content identity.

### Screenshot

- If there are no windows, go directly to **Capture physical area**.
- If windows exist, offer **Capture window** or **Capture physical area**.
- **Capture window:** select a source window with one click, then capture its digital content directly. This gives a sharp image without photographing the projection.
- **Capture physical area:** temporarily hide projected windows and controls, capture the selected real-world region with the camera, and restore the windows. Temporary hiding does not delete or reset them. Camera-to-surface calibration is required for an accurate crop. If darkness makes capture unusable, the capture step needs appropriate neutral illumination or ambient light.
- Show the result in a new screenshot window. If the chosen result placement conflicts with existing windows, ask for another free position.

Ask AI takes its desk photo through the hand tracker, which already has the camera open, instead of opening the camera in the browser. The projection is blanked for that moment so the photo shows only the desk.

### New Surface

Repeat the startup surface steps for one or more additional surfaces: drag the four corners with the mouse and keyboard, confirm, optionally add more, then run the marker, C and OK alignment for the new surfaces only. Existing surfaces and windows stay as they are. **Cancel new surface** returns to the workspace.

### Ask AI

Ask AI is not in the main menu. A thumbs-up held 0.5 s opens a prompt next to the hand with **Voice**, **Screenshot**, and **Cancel**; thumbs-down or Esc backs out at any step. **Voice** asks where the chat goes (draw it like a window) and starts a hands-free voice chat: it listens, sends each sentence when you pause, reads Gemini's answer aloud, and shows both sides as a transcript. **Screenshot** takes a camera photo of the whole desk at that moment, then asks where the chat goes; the photo appears in the chat, you drag a box over the part to ask about, Gemini describes it in one sentence, and the same voice chat starts with that image as context. Only the newest chat listens; older ones pause and show **Listen** to take the microphone back. **Ask AI** is also in the program picker, as the mouse fallback: it offers Voice or Screenshot inside that window. A thumbs-up is ignored during setup, while drawing, moving, or resizing, and while an Ask AI prompt, placement, or crop is open.

## Gestures

Every activating gesture is held for 0.5 s. While a hold builds up, the cursor ring (15 px, colored by surface) fills.

| Gesture | Shell response |
| --- | --- |
| One-hand pinch | Click; keep pinching to drag. |
| Both hands pinched and still | **Open main menu?** Yes/No, then **Make Window / Screenshot / New Surface**. |
| Both hands pinched, then spread | Draw the area after Make Window or Screenshot. |
| Peace sign | **Manage windows?** Yes/No, then **Move / Resize / Change surface**, then pinch the target window. |
| Thumbs down | **Close something?** Yes/No, then **Window / Surface**, then pinch the target. Closing a surface asks once more, then removes it and its windows. |
| Index finger pointing | Scroll lists or window content while held, without an approval prompt. |
| Thumbs up | **Ask AI** next to the hand: **Voice / Screenshot / Cancel**. |

- **Move:** drag the selected window on its surface; prevent overlap and boundary crossing.
- **Resize:** expose draggable controls on the selected window's four corners; keep it within its surface and free of overlap.
- **Change surface:** show large numbered labels on the other calibrated surfaces; choose a destination, pinch a free spot there, and prevent overlap.

Gesture-triggered menus ask Yes/No once before opening, except for ordinary pointing and scrolling. Choices inside a menu are direct. A one-hand pinch confirms the centered program-picker item.

## Mouse testing equivalents

The shell should remain fully testable without a camera. The footer buttons **Menu**, **Manage** and **Close** open the same menus as the two-hand hold, peace sign and thumbs down. Clicks can select actions, targets, numbered surfaces, and Yes/No. Click-drag stands in for two-hand window definition, moving, and corner resizing; the mouse wheel stands in for pointer-finger scrolling. The screen should label these temporary testing controls without making them the projected product's primary visual language.

## Implementation boundaries and unresolved technical details

- The shell now implements calibration-first setup, action-before-draw, per-surface perspective transforms, camera-target alignment, and the window management states. Digital screenshot rendering and browser camera capture have implementation paths but still require browser and hardware validation. No AI model endpoint is connected.
- The shell consumes the version 1 pointer and gesture events listed in `docs/input.md`. Hand gesture recognition belongs to input; the shell decides actions and target selection; widgets render inside windows. Camera points are transformed by the shell with the per-surface marker calibration and fingertip offset, so the tracker must not also warp them.
- Precise physical screenshots require mapping camera pixels to each calibrated surface. Projector correction and camera input mapping are related, but they are distinct transformations.
- A reliable nonoverlap policy should be tested on each surface's logical coordinates, including after moving or resizing. The user-facing result should stay predictable when a proposed placement is invalid.
