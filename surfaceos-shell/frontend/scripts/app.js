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

function createWindow(bounds, content) {
  const w = { id: `window-${nextId++}`, ...bounds, content, surface_id: 'main', note: '' };
  windows.push(w);
  activeId = w.id;
  mode = 'idle'; pendingBounds = null; menu.hidden = true; selection.hidden = true;
  render();
  setStatus(`${content === 'notes' ? 'Notes' : 'Workspace'} created · Drag its top bar to move`);
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

function render() {
  windowsLayer.replaceChildren();
  welcome.hidden = windows.length > 0 || mode === 'drawing';
  for (const [index, w] of windows.entries()) {
    const frame = document.createElement('section');
    frame.className = `surface-window${w.id === activeId ? ' active' : ''}`;
    frame.dataset.windowId = w.id;
    frame.style.zIndex = String(index + 1);
    frame.setAttribute('aria-label', `${w.content} window`);
    setRect(frame, w);
    const header = document.createElement('div'); header.className = 'window-header';
    const symbol = document.createElement('span'); symbol.className = 'window-symbol'; symbol.textContent = w.content === 'notes' ? '✎' : '▦';
    const title = document.createElement('span'); title.className = 'window-title'; title.textContent = `${w.content === 'notes' ? 'Notes' : 'Workspace'} · ${w.id}`;
    const close = document.createElement('button'); close.className = 'window-close'; close.type = 'button'; close.title = 'Close window'; close.setAttribute('aria-label', `Close ${w.id}`); close.textContent = '×';
    close.addEventListener('click', () => {
      windows = windows.filter(item => item.id !== w.id);
      activeId = windows.at(-1)?.id ?? null;
      render(); setStatus('Window closed');
    });
    header.append(symbol, title, close);
    const host = document.createElement('div'); host.className = 'widget-host'; renderContent(w, host);
    const resize = document.createElement('div'); resize.className = 'resize-handle'; resize.setAttribute('aria-label', 'Resize window');
    frame.append(header, host, resize); windowsLayer.append(frame);
  }
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
  const menuWidth = 254, menuHeight = menu.offsetHeight || 210;
  menu.style.left = `${clamp((bounds.x + bounds.width) * rect.width + 10, 10, rect.width - menuWidth - 10)}px`;
  menu.style.top = `${clamp((bounds.y + bounds.height) * rect.height + 10, 10, rect.height - menuHeight - 75)}px`;
  setStatus('Choose what to open in this window');
  menu.querySelector('[data-content]')?.focus();
}

function emitContentPointer(w, event) {
  const host = document.querySelector(`[data-window-id="${w.id}"] .widget-host`);
  if (!host) return;
  const box = host.getBoundingClientRect();
  const rect = stage.getBoundingClientRect();
  const x = clamp((event.x * rect.width - box.left + rect.left) / box.width, 0, 1);
  const y = clamp((event.y * rect.height - box.top + rect.top) / box.height, 0, 1);
  host.dispatchEvent(new CustomEvent('surfaceos:window-pointer', {
    detail: { version: 1, window_id: w.id, type: event.type, x, y, source: event.source }, bubbles: true,
  }));
}

function handleInput(event, target = null) {
  if (event?.version !== 1 || typeof event.type !== 'string') return false;
  if (event.type === 'double_pinch') { armCreation(); return true; }
  if (!['pointer_move', 'pointer_down', 'pointer_up', 'pointer_cancel'].includes(event.type)) return false;
  if (event.type === 'pointer_cancel') { handCursor.hidden = true; cancel(); return true; }
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
    if (!frame) return false;
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
      if (interaction.control === target?.closest('.window-close')) interaction.control.click();
      mode = 'idle'; interaction = null; return true;
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
document.addEventListener('keydown', e => {
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
    widgetRenderer = renderer; render();
  },
  getState: () => ({ mode, windows: structuredClone(windows) }),
  reset: () => { windows = []; activeId = null; cancel(); },
});

render();
