# Andres's SurfaceOS widget starter

From the repository root, run `python -m http.server 8000 --directory frontend` and open `http://localhost:8000/widget-demo.html`. No install needed. The renderer is isolated because the current `frontend/index.html` is still a pinch and snip prototype without a window shell.

Other pages on the same server:

- `widget-demo.html?autoplay` plays a scripted fake hand stream on load (also available from the **Play fake hand stream** button). Escape cancels a mouse press.
- `widget-tests.html` runs the renderer tests in the browser and shows `ALL TESTS PASSED` or the failures.

`widget-fixtures.js` holds shared fixture window records, layouts (`workspaceLayout`, `notesLayout`, `brokenLayout`), and `fakeHandStream()`. The stream uses full-canvas pointer events in the input contract shape, so the shell and input work can use the same file.

## Integrate with Carter's shell

Import `createWidgetRenderer` from `widget-renderer.js` and include `widgets.css`. Make a dedicated content element **inside each window frame**, then create one renderer per window:

```js
const renderer = createWidgetRenderer(contentElement, {
  onAction(action) {
    // Carter updates the shell state for action.window_id and action.widget_id.
    shellHandleWidgetAction(action);
  }
});
renderer.renderLayout({ version: 1, window_id: windowRecord.id, widgets: [...] });
```

An optional `warn(message, detail)` option replaces `console.warn` for renderer warnings.

The shell first routes a full-canvas pointer to the intended window, handles frame movement/resize, and converts its position to normalized coordinates within the **content element**. For an event meant for this renderer, call `renderer.handlePointer({version:1,type:'pointer_down',x:localX,y:localY,source:'hand'})` (also `pointer_move`, `pointer_up`, and `pointer_cancel`). Events without `version: 1` are ignored. Keep the press routed to the same window until release or cancel. Do not dispatch widget pointers during window creation, move, or resize. Call `clear()` when removing a window. Call `renderLayout` again after content changes; a pending press is canceled.

`handlePointer` returns `true` when the event landed on a button (down or move), activated one (up), or canceled a press in progress; otherwise `false`. The renderer draws hover and pressed states from `pointer_move`, since hand input has no browser hover.

A button activates only if pressed and released over the same button. A canceled press never activates. All displayed text uses `textContent`, so layout text is never parsed as HTML. Unknown widget types, missing or duplicate IDs, and invalid rectangles are skipped; each skip is logged and listed in a visible warning box inside that window. An invalid layout is rejected with a warning and the previous content stays in place. An exception thrown by `onAction` is logged and does not break the renderer. This starter includes `button` and `text`; implement slider, capture panel, and game only after choosing a concrete live demo path with Carter. Capture and Ask AI buttons emit actions; Carter owns their actual behavior and should not display them as functional until connected.

Contract version: **1**, matching `CLAUDE.md`. No shared contract was changed. The shell must keep window IDs unique and validate action IDs against its current content before changing app state. Confirm the existing repo's file paths and event format with Carter before merging.
