# SurfaceOS interaction specification

Status: agreed product flow for the ShellHacks build, 2026-09-26. This document describes the intended behavior, not a claim that every step is implemented. Keep one copy at the root of the team repository. The shell, app, and input owners should read it alongside `CLAUDE.md` before changing a shared interaction.

## The product in one sentence

Calibrate physical **surfaces**, then create and use movable program **windows** on those surfaces with a projector, camera, hand gestures, and a mouse fallback. A surface is a physical work area; a window is a program container. An AI conversation, screenshot viewer, utility, or game is window content, not a separate operating mode.

## Source of truth and ownership

- This file governs *what happens and in what order*. `CLAUDE.md` governs team ownership and repository rules. `WIDGETS.md` and `docs/input.md` document the present app and hand-input APIs; reconcile their implementations with this flow rather than silently changing the flow to match a demo.
- The shell owns the current mode, surface records, window IDs and bounds, frames, placement, confirmations, menus, and dispatch to window contents.
- The app owner owns programs and controls inside a supplied content element. An app returns actions to the shell and does not create or move its own outer window.
- The input owner owns camera tracking, calibrated pointer positions, gesture recognition, loss of tracking, and the input stream. It does not decide what a gesture means in the current shell mode.
- Both mouse and hand input enter the same shell state machine. A mouse test must exercise the full shell flow even before camera integration works.
- If a behavior is changed by the team, edit this one specification and notify all three owners. Do not keep competing copies of `UX_FLOW.md` in nested projects.

## Terms and invariants

| Term | Meaning |
| --- | --- |
| Surface | Numbered, calibrated, approximately planar physical area inside usable projection and camera coverage. |
| Window | One movable and resizable program container assigned to exactly one surface. |
| Canvas coordinates | Normalized `x,y` in `0..1` across the full projected canvas, origin at top left. |
| Content coordinates | Normalized `x,y` in `0..1` inside one window's content element. The shell converts between the two. |

Windows cannot overlap or cross a surface boundary. A window crossing a fold is not treated as one flat rectangle. A curved object needs more geometry than this build promises. Reject an invalid placement with a visible reason and let the user retry; do not silently place it somewhere else. Keep existing windows and content intact unless the user explicitly closes one. Show a small, clear way to cancel a mode and return to the previous stable state.

## Main state sequence

```text
Launch
  -> Calibrate Surface 1
  -> Add another surface? (repeat calibration and numbering if Yes)
  -> Nearly blank workspace with New Window / Screenshot / Ask AI
  -> User chooses one action
  -> Complete that action and return to the workspace
```

Every launch begins with calibration. Do not automatically restore a previous surface profile, window, or note. Setup must verify that projected corners and center align with the physical area and that camera input maps to the same logical surface. The exact calibration UI may evolve, but finishing calibration is required before creating windows. The numbered surface labels should be available again when a cross-surface move is requested.

The workspace starts visually quiet. The three main actions are **New Window**, **Screenshot**, and **Ask AI**. Selecting one of these visible actions is direct; do not ask a second Yes/No question just to begin it. Gesture-triggered commands that could change the current mode use the confirmations described below.

## 1. New Window

1. Select **New Window** first. The user has not drawn anything yet.
2. Enter placement mode. With hands, pinch with both hands and move them apart to outline the proposed rectangle in real time; release to finish. With a mouse, click and drag to outline it. Show which surface contains the area.
3. On release, validate the proposed bounds against that surface and every existing window. If invalid, explain why and stay in placement mode for a retry. Escape/Cancel returns to the workspace without a window.
4. If valid, reserve the window and open a **scrollable program picker** for its content. Point or flick to scroll. The centered entry is displayed as `> selection <`; the footer says **Pinch to confirm**. One-hand pinch confirms that entry. A mouse click confirms it in mouse mode. Scrolling needs no confirmation prompt.
5. Mount the selected app in that window, using the shell's unique window ID and the selected content type. The window stays on its chosen surface. Return to normal interaction.

The picker can include whichever programs are actually functional in the build. Do not show an unfinished item as a working choice. A window's frame and resize controls belong to the shell; controls inside it belong to the app.

## 2. Screenshot

| Current state | Next step |
| --- | --- |
| No windows exist | Go directly to **Capture physical area**. |
| At least one window exists | Ask **Capture window** or **Capture physical area**. |

**Capture window:** Select the source window with one click (one pointer activation in hand mode). Capture its *digital content* rather than photographing its projection. Open the result in a new screenshot window. The source window remains open. If there is no free place for the result, ask the user to place it; enforce the usual nonoverlap rule.

**Capture physical area:** Select a calibrated surface region. Temporarily hide the projected windows and controls, take a camera image of that real-world region, then restore the existing windows. The windows are hidden only for capture; this choice does not delete them. If projection was the only light, provide enough neutral/ambient light to obtain a usable camera image. Show the actual captured image in a new screenshot window placed in free space.

An aborted or failed capture restores the existing display and reports the problem. **Ask AI's camera action reuses this physical-area capture path** so that the AI receives the real scene rather than UI pixels.

## 3. Ask AI

1. Select **Ask AI** from the main actions, then define valid bounds for its conversation window using the same placement and overlap rules as New Window.
2. Open a conversation in that window. The user can type a question; microphone and camera actions may be exposed when working.
3. A camera action captures the selected real-world area through the physical screenshot path. The answer uses the user's actual question and/or the actual captured image.
4. If microphone, camera, network, or model service is unavailable, explain that state in the window. Never present a fixed demonstration answer as though it came from a live model.

An object-recognition or repair guide can later be another program or an AI capability. It does not replace the window-creation flow.

## 4. Window commands after creation

| Trigger | Shell response | Selection and completion |
| --- | --- | --- |
| Two-hand single pinch | Offer to reopen **New Window / Screenshot / Ask AI**. | Brief Yes/No confirmation before leaving the current mode; then choose an action directly. |
| Two-hand double pinch | Offer **Move** or **Resize**. | Confirm the chosen operation once, then select the target window with one click. Do not reconfirm every movement frame. |
| Thumbs down | Offer **Close**. | Confirm once, select the target window with one click, then close it. |
| Index-finger point or flick | Scroll the list or current content. | No approval dialog. |

**Move on one surface:** Drag the selected window within its surface. Keep it inside the boundary and clear of other windows. On release, commit a valid position; otherwise show the conflict and retain its last valid position.

**Move to another surface:** Ask **Do you want to move a window to a new surface?** Show large surface numbers, like display identification in system settings. The user chooses a destination number and places the window in free space there. Keep its ID and content. If the destination cannot fit it, retain the original placement and request another destination or position.

**Resize:** After target selection, show controls on all four corners. Drag a corner to preview the new bounds. Apply only a valid size within the assigned surface without overlap. A widget press that starts inside content is routed to the app; a drag starting on the frame or a resize handle is handled by the shell.

**Close:** Close only the chosen window, release its occupied area, and destroy its app instance. Other windows stay where they are.

At any Yes/No prompt, No returns to the state before the gesture. Tracking loss or pointer cancellation releases a captured press/drag without activating a widget or committing an unfinished placement. The shell must always have an obvious mouse fallback for these operations.

## Input and app boundary

The existing input service uses `ws://localhost:8765` and version 1 JSON pointer events such as:

```json
{"version":1,"type":"pointer_down","x":0.42,"y":0.68,"source":"hand"}
```

`pointer_move`, `pointer_down`, `pointer_up`, and `pointer_cancel` refer to full-canvas coordinates. One pinch creates one down and one up; holding does not repeat down events. The shell owns hit testing, pointer capture, and conversion to window-content coordinates. The app receives its own window-local pointer stream and can emit an action such as:

```json
{"version":1,"window_id":"window-1","widget_id":"next","event":"activate"}
```

The current hand service emits one primary pointer and a **one-hand** `double_pinch`. This does **not** implement the two-hand single/double pinch commands above or simultaneous two-hand placement. Do not interpret its `double_pinch` as `two_hand_double_pinch`. The input owner and shell owner must agree on new, distinct event names and multi-hand data before enabling those gestures. Keep mouse commands available while that work is in progress. The currently published `frontend/apps-demo.html` is a temporary app host; it is not this window-management experience.

## Acceptance walkthroughs

1. **Startup and two windows:** Launch, calibrate Surface 1, decline another surface, choose New Window, draw a valid area, scroll the program picker, confirm an app, and use it. Create a second nonoverlapping window with different content. Both stay interactive.
2. **Placement guard:** Try to draw across a surface boundary and over another window. Each attempt explains the conflict and allows retry without altering existing windows.
3. **Move and resize:** Invoke the operation, confirm once, select the target in one click, move or resize it, and observe valid bounds and collision handling. A click inside an app still goes to the app.
4. **Window capture:** With windows open, choose Screenshot > Capture window, select one window, and get a sharp digital image in a separate window. The original remains.
5. **Physical capture:** Choose Screenshot > Capture physical area. Existing windows disappear temporarily, the camera captures the real scene, existing windows return, and the image opens in a free window. A failed capture also restores them.
6. **AI evidence:** Ask AI with a typed/spoken question or camera capture; verify the response is tied to that actual input. If its service is unavailable, show a clear error.
7. **Cancellation and restart:** Cancel a drag or lose tracking without a false click. Restart the program and require calibration again instead of restoring prior windows.
8. **Multiple surfaces, when physically ready:** Calibrate and number two planar surfaces, move a selected window to Surface 2 by number, and verify the projected corners and center on both.

For the hackathon, prioritize a repeatable mouse walkthrough of startup, creation, two windows, an app interaction, and move/resize. Add hand control and real capture through the same flows as they become reliable. Report which walkthroughs were actually tested with a mouse, hand tracker, camera, and projector. Do not imply that a mock or preset is live recognition.

## Repository handling

Coding agents leave changes in the working tree for human review. They do not commit, push, tag, merge, open pull requests, or add themselves as contributors. Keep project artifacts free of emojis, agent signatures, self-references, and AI attribution tags. Follow any disclosure required by event or repository rules. Do not add virtual environments, secrets, recordings, or machine-specific calibration files to the repository.
