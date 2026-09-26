/** SurfaceOS widget renderer contract v1. No framework or global CSS required. */
export function createWidgetRenderer(container, { onAction = () => {}, warn = console.warn } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('container must be an HTMLElement');
  let current = null;
  let active = null;
  const supported = new Set(['button', 'text']);
  container.classList.add('surfaceos-widgets');

  function renderLayout(layout) {
    if (!layout || layout.version !== 1 || typeof layout.window_id !== 'string' || !layout.window_id || !Array.isArray(layout.widgets)) {
      warn('Invalid SurfaceOS widget layout', layout);
      return false;
    }
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    for (const widget of layout.widgets) {
      if (!widget || typeof widget.id !== 'string' || !widget.id || seen.has(widget.id)) {
        warn('Skipping widget with missing or duplicate id', widget);
        continue;
      }
      seen.add(widget.id);
      if (!supported.has(widget.type)) {
        warn(`Unsupported widget type: ${String(widget.type)}`);
        continue;
      }
      const { x, y, width, height } = widget;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
        warn('Skipping widget with invalid window-local bounds', widget);
        continue;
      }
      const element = document.createElement(widget.type === 'button' ? 'button' : 'div');
      if (widget.type === 'button') element.type = 'button';
      element.className = `surfaceos-widget surfaceos-widget--${widget.type}`;
      element.dataset.widgetId = widget.id;
      element.textContent = typeof widget.text === 'string' ? widget.text : '';
      element.style.left = `${x * 100}%`;
      element.style.top = `${y * 100}%`;
      element.style.width = `${width * 100}%`;
      element.style.height = `${height * 100}%`;
      fragment.append(element);
    }
    active = null;
    current = { window_id: layout.window_id };
    container.replaceChildren(fragment);
    return true;
  }

  // Shell calls this only after its own create/move/resize and pointer routing.
  // Coordinates are normalized INSIDE this window. No DOM click handler is used,
  // so a browser's synthetic click cannot trigger a second action.
  function handlePointer(event) {
    if (!current || !event || event.version !== 1 || !['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel'].includes(event.type)) return false;
    if (event.type === 'pointer_cancel') { active = null; return true; }
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return false;
    const x = event.x, y = event.y;
    const hit = x >= 0 && y >= 0 && x <= 1 && y <= 1
      ? [...container.querySelectorAll('.surfaceos-widget--button')].find(el => {
          const left = parseFloat(el.style.left) / 100, top = parseFloat(el.style.top) / 100;
          return x >= left && y >= top && x <= left + parseFloat(el.style.width) / 100 && y <= top + parseFloat(el.style.height) / 100;
        }) : null;
    if (event.type === 'pointer_down') { active = hit ? { windowId: current.window_id, widgetId: hit.dataset.widgetId } : null; return !!hit; }
    if (event.type === 'pointer_up') {
      const pressed = active;
      active = null;
      if (pressed && hit?.dataset.widgetId === pressed.widgetId && pressed.windowId === current.window_id) {
        onAction({ version: 1, window_id: pressed.windowId, widget_id: pressed.widgetId, event: 'activate' });
        return true;
      }
    }
    return false;
  }

  return { renderLayout, handlePointer, clear() { active = null; current = null; container.replaceChildren(); } };
}
