import { clamp, contains, moveWithinCanvas, rectangleBetween, resizeWithinCanvas } from './geometry.js';

const stage = document.querySelector('#stage');
const windowsLayer = document.querySelector('#windows');
const selection = document.querySelector('#selection');
const menu = document.querySelector('#content-menu');
const welcome = document.querySelector('#welcome');
const status = document.querySelector('#status');
const handCursor = document.querySelector('#hand-cursor');

let windows = [];
let nextId = 1;
let activeId = null;
let mode = 'idle'; // idle, armed, drawing, choosing, moving, resizing, content, control
let interaction = null;
let pendingBounds = null;
let widgetRenderer = null;

function setStatus(message) { status.textContent = message; }
function setRect(element, rect) {
  element.style.left = `${rect.x * 100}%`;
  element.style.top = `${rect.y * 100}%`;
  element.style.width = `${rect.width * 100}%`;
  element.style.height = `${rect.height * 100}%`;
}

function pointFromClient(clientX, clientY) {
  const bounds = stage.getBoundingClientRect();
  return { x: clamp((clientX - bounds.left) / bounds.width, 0, 1), y: clamp((clientY - bounds.top) / bounds.height, 0, 1) };
}

function elementAt(point) {
  const bounds = stage.getBoundingClientRect();
  return document.elementFromPoint(bounds.left + point.x * bounds.width, bounds.top + point.y * bounds.height);
}

function focusWindow(id) {
  activeId = id;
  const index = windows.findIndex(w => w.id === id);
  if (index >= 0) windows.push(...windows.splice(index, 1));
  for (const [position, w] of windows.entries()) {
    const element = document.querySelector(`[data-window-id="${w.id}"]`);
    if (element) { element.style.zIndex = String(position + 1); element.classList.toggle('active', w.id === id); }
  }
}

// Apps come from the mounted widget renderer; Workspace and Notes are built into the shell.
function appFor(content) {
  return widgetRenderer?.apps?.find(app => app.type === content) ?? null;
}

function contentInfo(content) {
  if (content === 'notes') return { title: 'Notes', symbol: '✎' };
  if (content === 'workspace') return { title: 'Workspace', symbol: '▦' };
  return { title: appFor(content)?.title ?? content, symbol: '◆' };
}

function createWindow(bounds, content) {
  const w = { id: `window-${nextId++}`, ...bounds, content, surface_id: 'main', note: '' };
  windows.push(w);
  activeId = w.id;
  mode = 'idle'; pendingBounds = null; menu.hidden = true; selection.hidden = true;
  render();
  setStatus(`${contentInfo(content).title} created · Drag its top bar to move`);
}

function widgetLayout(w) {
  return { version: 1, window_id: w.id, widgets: [
    { id: 'welcome', type: 'text', x: 0.12, y: 0.14, width: 0.76, height: 0.2, text: 'An open workspace' },
    { id: 'notes', type: 'button', x: 0.29, y: 0.54, width: 0.42, height: 0.22, text: 'Open notes' },
  ] };
}

function dispatchWidgetAction(action) {
  if (action?.version !== 1 || action.event !== 'activate' || typeof action.window_id !== 'string') return false;
  const w = windows.find(item => item.id === action.window_id);
  if (!w) return false;
  if (action.widget_id === 'notes') {
    w.content = 'notes'; focusWindow(w.id); render();
    setStatus('Notes opened'); return true;
  }
  return false;
}

function renderContent(w, host) {
  if (w.content === 'notes') {
    const note = document.createElement('textarea');
    note.className = 'note-area'; note.placeholder = 'Write something here…';
    note.setAttribute('aria-label', `Notes in ${w.id}`);
    note.value = w.note;
    note.addEventListener('input', () => { w.note = note.value; });
    host.append(note);
    return;
  }
  if (appFor(w.content) && widgetRenderer.mountApp) {
    // The app keeps its own state; the shell still owns the frame and content identity.
    widgetRenderer.mountApp({ id: w.id, content: w.content }, host, action => console.debug('SurfaceOS app action', action));
    return;
  }
  if (widgetRenderer) {
    widgetRenderer.renderLayout(widgetLayout(w), host, dispatchWidgetAction);
    return;
  }
  const fallback = document.createElement('div');
  fallback.className = 'workspace-fallback';
  const symbol = document.createElement('div'); symbol.className = 'workspace-symbol'; symbol.textContent = '✦';
  const title = document.createElement('strong'); title.textContent = 'An open workspace';
  const hint = document.createElement('span'); hint.textContent = 'Your widgets can live here.';
  const openNotes = document.createElement('button'); openNotes.type = 'button'; openNotes.textContent = 'Open notes';
  openNotes.dataset.shellAction = 'notes';
  openNotes.addEventListener('click', () => dispatchWidgetAction({ version: 1, window_id: w.id, widget_id: 'notes', event: 'activate' }));
  fallback.append(symbol, title, hint, openNotes); host.append(fallback);
}

// Frames whose window still shows the same content are kept in place rather than rebuilt:
// detaching a frame would reload any embedded player and drop focus. Stacking uses z-index,
// so existing frames never need to move in the DOM.
function render() {
  welcome.hidden = windows.length > 0 || mode === 'drawing';
  const previous = new Map([...windowsLayer.children].map(frame => [frame.dataset.windowId, frame]));
  for (const [index, w] of windows.entries()) {
    const contentKey = `${w.content}|${widgetRenderer ? 'widgets' : 'fallback'}`;
    let frame = previous.get(w.id);
    previous.delete(w.id);
    if (frame?.dataset.contentKey !== contentKey) {
      const replacement = buildFrame(w, contentKey);
      if (frame) frame.replaceWith(replacement); else windowsLayer.append(replacement);
      frame = replacement;
    }
    frame.classList.toggle('active', w.id === activeId);
    frame.style.zIndex = String(index + 1);
    setRect(frame, w);
  }
  for (const frame of previous.values()) frame.remove();
  // Lets the widget renderer release content for windows that closed or changed content.
  widgetRenderer?.sync?.(windows.map(({ id, content }) => ({ id, content })));
}

function buildFrame(w, contentKey) {
  const frame = document.createElement('section');
  frame.className = 'surface-window';
  frame.dataset.windowId = w.id;
  frame.dataset.contentKey = contentKey;
  frame.setAttribute('aria-label', `${w.content} window`);
  const header = document.createElement('div'); header.className = 'window-header';
  const info = contentInfo(w.content);
  const symbol = document.createElement('span'); symbol.className = 'window-symbol'; symbol.textContent = info.symbol;
  const title = document.createElement('span'); title.className = 'window-title'; title.textContent = `${info.title} · ${w.id}`;
  const close = document.createElement('button'); close.className = 'window-close'; close.type = 'button'; close.title = 'Close window'; close.setAttribute('aria-label', `Close ${w.id}`); close.textContent = '×';
  close.addEventListener('click', () => {
    windows = windows.filter(item => item.id !== w.id);
    activeId = windows.at(-1)?.id ?? null;
    render(); setStatus('Window closed');
  });
  header.append(symbol, title, close);
  const host = document.createElement('div'); host.className = 'widget-host'; renderContent(w, host);
  const resize = document.createElement('div'); resize.className = 'resize-handle'; resize.setAttribute('aria-label', 'Resize window');
  frame.append(header, host, resize);
  return frame;
}

function armCreation() {
  mode = 'armed'; interaction = null; pendingBounds = null; menu.hidden = true; selection.hidden = true;
  setStatus('Draw mode · Drag on empty space to place a window · Esc to cancel');
}

function cancel() {
  mode = 'idle'; interaction = null; pendingBounds = null; menu.hidden = true; selection.hidden = true;
  render(); setStatus('Ready · Double-click to create');
}

function showMenu(bounds) {
  mode = 'choosing'; pendingBounds = bounds;
  menu.hidden = false;
  const rect = stage.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 254, menuHeight = menu.offsetHeight || 210;
  menu.style.left = `${clamp((bounds.x + bounds.width) * rect.width + 10, 10, Math.max(10, rect.width - menuWidth - 10))}px`;
  menu.style.top = `${clamp((bounds.y + bounds.height) * rect.height + 10, 10, Math.max(10, rect.height - menuHeight - 75))}px`;
  setStatus('Choose what to open in this window');
  menu.querySelector('[data-content]')?.focus();
}

// Adds a compact grid of the widget renderer's apps below Workspace and Notes.
function buildAppMenu() {
  menu.querySelector('.menu-apps')?.remove();
  const apps = widgetRenderer?.apps ?? [];
  if (!apps.length) return;
  const section = document.createElement('div'); section.className = 'menu-apps';
  const label = document.createElement('p'); label.className = 'menu-eyebrow'; label.textContent = 'APPS';
  const grid = document.createElement('div'); grid.className = 'menu-app-grid';
  for (const app of apps) {
    const item = document.createElement('button'); item.type = 'button'; item.dataset.content = app.type; item.textContent = app.title;
    grid.append(item);
  }
  section.append(label, grid);
  menu.insertBefore(section, document.querySelector('#menu-cancel'));
}

function emitContentPointer(w, event) {
  const host = document.querySelector(`[data-window-id="${w.id}"] .widget-host`);
  if (!host) return;
  const box = host.getBoundingClientRect();
  const rect = stage.getBoundingClientRect();
  // Not clamped: a release outside the window must not count as a release on an edge widget.
  const x = (event.x * rect.width - box.left + rect.left) / box.width;
  const y = (event.y * rect.height - box.top + rect.top) / box.height;
  host.dispatchEvent(new CustomEvent('surfaceos:window-pointer', {
    detail: { version: 1, window_id: w.id, type: event.type, x, y, source: event.source }, bubbles: true,
  }));
}

function handleInput(event, target = null) {
  if (event?.version !== 1 || typeof event.type !== 'string') return false;
  if (event.type === 'double_pinch') {
    // Two quick pinches on a window or control are two presses there, not a request for a new window.
    const over = Number.isFinite(event.x) && Number.isFinite(event.y) ? elementAt(event) : null;
    if (over?.closest('.surface-window, .chrome, .content-menu, .welcome button')) return false;
    armCreation(); return true;
  }
  if (!['pointer_move', 'pointer_down', 'pointer_up', 'pointer_cancel'].includes(event.type)) return false;
  if (event.type === 'pointer_cancel') {
    // Releases a press inside window content too, so no widget stays pressed after tracking is lost.
    const pressed = mode === 'content' ? windows.find(item => item.id === interaction?.id) : null;
    if (pressed) emitContentPointer(pressed, event);
    handCursor.hidden = true; cancel(); return true;
  }
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y) || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) return false;
  target ??= elementAt(event);
  if (event.source === 'hand') {
    handCursor.hidden = false;
    handCursor.style.left = `${event.x * 100}%`; handCursor.style.top = `${event.y * 100}%`;
  }
  if (event.type === 'pointer_down') {
    if (mode === 'choosing') {
      if (!target?.closest('#content-menu')) cancel();
      else if (event.source === 'hand') interaction = { menuTarget: target.closest('#content-menu button') };
      return true;
    }
    if (mode === 'armed') {
      if (target?.closest('.chrome, .surface-window, .welcome')) return false;
      mode = 'drawing'; interaction = { start: { x: event.x, y: event.y } };
      welcome.hidden = true; selection.hidden = false;
      setRect(selection, { x: event.x, y: event.y, width: 0, height: 0 }); return true;
    }
    if (mode !== 'idle') return false;
    const frame = target?.closest('.surface-window');
    if (!frame) {
      // Shell buttons outside windows only receive native mouse clicks, so a hand press
      // is held here and becomes a click on release over the same button.
      const control = event.source === 'hand' ? target?.closest('.chrome button, .welcome button') : null;
      if (!control) return false;
      mode = 'control'; interaction = { control }; return true;
    }
    const w = windows.find(item => item.id === frame.dataset.windowId);
    if (!w) return false;
    focusWindow(w.id);
    if (target.closest('.window-close')) {
      if (event.source === 'hand') { mode = 'control'; interaction = { control: target }; }
      return false;
    }
    if (target.closest('.resize-handle, .window-header')) {
      mode = target.closest('.resize-handle') ? 'resizing' : 'moving';
      interaction = { id: w.id, start: { x: event.x, y: event.y }, bounds: { x: w.x, y: w.y, width: w.width, height: w.height } };
      setStatus(mode === 'moving' ? 'Moving window' : 'Resizing window'); return true;
    }
    if (event.source === 'hand') {
      mode = 'content';
      interaction = { id: w.id, control: target.closest('[data-shell-action]') };
      emitContentPointer(w, event);
    }
    return false;
  }
  if (event.type === 'pointer_move') {
    if (mode === 'drawing') { setRect(selection, rectangleBetween(interaction.start, event)); return true; }
    if (mode === 'moving' || mode === 'resizing') {
      const w = windows.find(item => item.id === interaction.id);
      if (!w) { cancel(); return false; }
      const dx = event.x - interaction.start.x, dy = event.y - interaction.start.y;
      Object.assign(w, mode === 'moving' ? moveWithinCanvas(interaction.bounds, dx, dy) : resizeWithinCanvas(interaction.bounds, dx, dy));
      const frame = document.querySelector(`[data-window-id="${w.id}"]`);
      if (frame) setRect(frame, w);
      return true;
    }
    if (mode === 'content' && event.source === 'hand') {
      const w = windows.find(item => item.id === interaction.id);
      if (w) emitContentPointer(w, event);
    }
    return false;
  }
  if (event.type === 'pointer_up') {
    if (mode === 'choosing' && event.source === 'hand') {
      if (interaction?.menuTarget && interaction.menuTarget === target?.closest('#content-menu button')) interaction.menuTarget.click();
      interaction = null; return true;
    }
    if (mode === 'drawing') {
      const bounds = rectangleBetween(interaction.start, event);
      interaction = null; selection.hidden = true;
      if (bounds.width < .12 || bounds.height < .1) { cancel(); setStatus('Draw a larger window (at least 12% × 10% of the canvas)'); }
      else showMenu(bounds);
      return true;
    }
    if (mode === 'moving' || mode === 'resizing') { mode = 'idle'; interaction = null; setStatus('Window updated'); return true; }
    if (mode === 'content' && event.source === 'hand') {
      const w = windows.find(item => item.id === interaction.id);
      if (w) emitContentPointer(w, event);
      if (interaction.control && interaction.control === target?.closest('[data-shell-action]')) interaction.control.click();
      mode = 'idle'; interaction = null; return true;
    }
    if (mode === 'control' && event.source === 'hand') {
      const control = interaction.control;
      mode = 'idle'; interaction = null;
      if (control === target?.closest('button')) control.click();
      return true;
    }
  }
  return false;
}

stage.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const point = pointFromClient(e.clientX, e.clientY);
  const handled = handleInput({ version: 1, type: 'pointer_down', ...point, source: 'mouse' }, e.target);
  if (handled && ['drawing', 'moving', 'resizing'].includes(mode)) {
    stage.setPointerCapture(e.pointerId); e.preventDefault();
  }
});
stage.addEventListener('pointermove', e => {
  handleInput({ version: 1, type: 'pointer_move', ...pointFromClient(e.clientX, e.clientY), source: 'mouse' }, e.target);
});
stage.addEventListener('pointerup', e => {
  handleInput({ version: 1, type: 'pointer_up', ...pointFromClient(e.clientX, e.clientY), source: 'mouse' }, e.target);
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
});
stage.addEventListener('pointercancel', e => {
  handleInput({ version: 1, type: 'pointer_cancel', ...pointFromClient(e.clientX, e.clientY), source: 'mouse' });
});
stage.addEventListener('dblclick', e => {
  if (!e.target.closest('.surface-window, .chrome, .content-menu, .welcome')) armCreation();
});

menu.addEventListener('click', e => {
  const content = e.target.closest('[data-content]')?.dataset.content;
  if (content && mode === 'choosing' && pendingBounds) createWindow(pendingBounds, content);
});
document.querySelector('#menu-cancel').addEventListener('click', cancel);
document.querySelector('#new-window').addEventListener('click', armCreation);
document.querySelector('#welcome-create').addEventListener('click', armCreation);
document.querySelector('#reset').addEventListener('click', () => {
  if (windows.length && !confirm('Clear all SurfaceOS windows and notes?')) return;
  windows = []; activeId = null; cancel();
});
document.querySelector('#demo-layout').addEventListener('click', () => {
  if (windows.length && !confirm('Replace the current windows with the demo layout?')) return;
  windows = [
    { id: `window-${nextId++}`, x: .09, y: .16, width: .38, height: .5, content: 'workspace', surface_id: 'main', note: '' },
    { id: `window-${nextId++}`, x: .54, y: .27, width: .34, height: .43, content: 'notes', surface_id: 'main', note: 'SurfaceOS turns a physical surface into a workspace.\n\nDrag either window by its top bar.' },
  ];
  activeId = windows[1].id; mode = 'idle'; menu.hidden = true; selection.hidden = true;
  render(); setStatus('Demo layout loaded');
});
document.querySelector('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.();
});
// Keyboard fallback for the focused window's app (typing, Pong's second paddle) comes before shortcuts.
function forwardKey(e) {
  if (mode !== 'idle' || !activeId || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.target.matches('textarea, input, [contenteditable]')) return false;
  if (!widgetRenderer?.handleKey?.(activeId, { type: e.type, key: e.key })) return false;
  e.preventDefault();
  return true;
}
document.addEventListener('keyup', forwardKey);
document.addEventListener('keydown', e => {
  if (forwardKey(e)) return;
  if (e.key === 'Escape') cancel();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches('textarea, input, [contenteditable]')) return;
  if (e.key.toLowerCase() === 'n') armCreation();
  if (e.key.toLowerCase() === 'f') document.querySelector('#fullscreen').click();
});

// The hand/input teammate sends the same v1 event shape used by the mouse adapter.
// A widget renderer can mount into each window without owning frames or app state.
window.SurfaceOS = Object.freeze({
  dispatchInput: event => handleInput(event),
  dispatchWidgetAction,
  mountWidgetRenderer: renderer => {
    if (!renderer || typeof renderer.renderLayout !== 'function') throw new TypeError('Expected renderLayout(layout, host, onAction)');
    widgetRenderer = renderer; buildAppMenu(); render();
  },
  getState: () => ({ mode, windows: structuredClone(windows) }),
  reset: () => { windows = []; activeId = null; cancel(); },
});

render();
