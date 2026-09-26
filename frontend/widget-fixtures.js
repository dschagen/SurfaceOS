// Shared fake data for the widget demo and tests: window records, layouts, and a
// scripted pointer stream in full-canvas coordinates, shaped like the input contract.

export const FIXTURE_WINDOWS = [
  { id: "window-1", x: 0.12, y: 0.18, width: 0.35, height: 0.42, content: "workspace", surface_id: "main" },
  { id: "window-2", x: 0.55, y: 0.3, width: 0.3, height: 0.36, content: "notes", surface_id: "main" },
];

export function workspaceLayout(windowId, pressCount = 0) {
  return {
    version: 1,
    window_id: windowId,
    widgets: [
      { id: "title", type: "text", x: 0.05, y: 0.03, width: 0.9, height: 0.16, text: "Workspace" },
      { id: "capture", type: "button", x: 0.08, y: 0.24, width: 0.4, height: 0.22, text: "Capture area" },
      { id: "ask", type: "button", x: 0.52, y: 0.24, width: 0.4, height: 0.22, text: "Ask AI" },
      { id: "counter", type: "button", x: 0.08, y: 0.56, width: 0.84, height: 0.22, text: "Press me" },
      {
        id: "count",
        type: "text",
        x: 0.05,
        y: 0.82,
        width: 0.9,
        height: 0.14,
        text: `Pressed ${pressCount} ${pressCount === 1 ? "time" : "times"}`,
      },
    ],
  };
}

export const NOTES = [
  "Double pinch, then drag, to make a window.",
  "Pinch a button and release on it to press.",
  "Each window keeps its own content.",
];

export function notesLayout(windowId, noteIndex = 0) {
  return {
    version: 1,
    window_id: windowId,
    widgets: [
      { id: "note", type: "text", x: 0.05, y: 0.06, width: 0.9, height: 0.56, text: NOTES[noteIndex % NOTES.length] },
      { id: "prev", type: "button", x: 0.08, y: 0.7, width: 0.38, height: 0.22, text: "Back" },
      { id: "next", type: "button", x: 0.54, y: 0.7, width: 0.38, height: 0.22, text: "Next" },
    ],
  };
}

// Deliberately broken entries so the renderer's warnings can be seen and tested.
export function brokenLayout(windowId) {
  return {
    version: 1,
    window_id: windowId,
    widgets: [
      { id: "ok", type: "button", x: 0.1, y: 0.1, width: 0.8, height: 0.25, text: "Still works" },
      { id: "slider", type: "slider", x: 0.1, y: 0.4, width: 0.8, height: 0.1 },
      { id: "ok", type: "text", x: 0.1, y: 0.55, width: 0.8, height: 0.1, text: "duplicate id" },
      { id: "huge", type: "button", x: 0.5, y: 0.5, width: 0.9, height: 0.2, text: "outside" },
      { type: "text", x: 0, y: 0, width: 0.1, height: 0.1, text: "no id" },
      { id: "html", type: "text", x: 0.1, y: 0.8, width: 0.8, height: 0.15, text: "<b>shown as text, not bold</b>" },
    ],
  };
}

// Converts a point inside a window's content (0..1) to full-canvas coordinates,
// ignoring any title bar. Good enough to aim fake input at a widget.
function aim(windowRecord, localX, localY) {
  return { x: windowRecord.x + localX * windowRecord.width, y: windowRecord.y + localY * windowRecord.height };
}

function event(type, point) {
  return { version: 1, type, ...point, source: "hand" };
}

// A short scripted hand session: press Capture, abandon a press by sliding off,
// lose tracking mid press, and press Next in the second window.
export function fakeHandStream(windows = FIXTURE_WINDOWS) {
  const [first, second] = windows;
  const steps = [];
  const glide = (from, to, count = 6) => {
    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      steps.push(event("pointer_move", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
    }
  };

  const start = { x: 0.05, y: 0.9 };
  const capture = aim(first, 0.28, 0.4);
  const ask = aim(first, 0.72, 0.4);
  const counter = aim(first, 0.5, 0.72);
  const next = aim(second, 0.73, 0.86);

  steps.push(event("pointer_move", start));
  glide(start, capture);
  steps.push(event("pointer_down", capture), event("pointer_up", capture)); // activates Capture
  glide(capture, ask, 4);
  steps.push(event("pointer_down", ask));
  glide(ask, counter, 4);
  steps.push(event("pointer_up", counter)); // released elsewhere: no activation
  steps.push(event("pointer_down", counter));
  steps.push({ version: 1, type: "pointer_cancel", source: "hand" }); // tracking lost: no activation
  glide(counter, next, 8);
  steps.push(event("pointer_down", next), event("pointer_up", next)); // activates Next in window-2
  return steps;
}
