# Andres's SurfaceOS widget starter

From the repository root, run `python -m http.server 8000 --directory frontend` and open `http://localhost:8000/widget-demo.html`. No install needed. The renderer is isolated because the current `frontend/index.html` is still a pinch and snip prototype without a window shell.

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

The shell first routes a full-canvas pointer to the intended window, handles frame movement/resize, and converts its position to normalized coordinates within the **content element**. For an event meant for this renderer, call `renderer.handlePointer({version:1,type:'pointer_down',x:localX,y:localY,source:'hand'})` (also `pointer_move`, `pointer_up`, and `pointer_cancel`). Keep the press routed to the same window until release or cancel. Do not dispatch widget pointers during window creation, move, or resize. Call `clear()` when removing a window. Call `renderLayout` again after content changes; a pending press is canceled.

A button activates only if pressed and released over the same button. A canceled press never activates. All displayed text uses `textContent`, so layout text is never parsed as HTML. Unknown widget types and invalid rectangles are skipped with warnings. This starter includes `button` and `text`; implement slider, capture panel, and game only after choosing a concrete live demo path with Carter. Capture and Ask AI buttons emit actions; Carter owns their actual behavior and should not display them as functional until connected.

Contract version: **1**, matching the attached `CLAUDE.md`. No shared contract was changed. The shell must keep window IDs unique and validate action IDs against its current content before changing app state. Confirm the existing repo's file paths and event format with Carter before merging.
