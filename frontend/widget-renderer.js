/** SurfaceOS widget renderer contract v1. No framework or global CSS required. */

const POINTER_TYPES = ['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel'];
const SUPPORTED = new Set(['button', 'text', 'canvas', 'video']);
const VARIANT_TOKEN = /^[a-z0-9-]{1,32}$/;
// Tolerates float error such as x 0.6 + width 0.4 landing just above 1.
const EPSILON = 1e-9;

function validBounds({ x, y, width, height }) {
  return [x, y, width, height].every(Number.isFinite)
    && x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= 1 + EPSILON && y + height <= 1 + EPSILON;
}

// Variants are style hints such as "primary" or "left"; they only ever become class names.
function variantTokens(variant) {
  if (variant === undefined || variant === null || variant === '') return { tokens: [] };
  const list = Array.isArray(variant) ? variant : String(variant).split(/\s+/);
  const tokens = list.filter((token) => typeof token === 'string' && VARIANT_TOKEN.test(token));
  return { tokens, invalid: tokens.length !== list.filter(Boolean).length };
}

function createElementFor(type) {
  if (type === 'button') {
    const element = document.createElement('button');
    element.type = 'button';
    // Input arrives through handlePointer, not browser focus or keyboard activation.
    element.tabIndex = -1;
    return element;
  }
  if (type === 'video') {
    const element = document.createElement('video');
    element.autoplay = true;
    element.muted = true;
    element.playsInline = true;
    return element;
  }
  return document.createElement(type === 'canvas' ? 'canvas' : 'div');
}

export function createWidgetRenderer(container, { onAction = () => {}, warn = console.warn } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('container must be an HTMLElement');
  let current = null;
  // Rendered widgets by id. Elements are reused across renders so canvases and videos keep their content.
  let nodes = new Map();
  // Enabled buttons in layout order, with a copy of their bounds for hit testing.
  let buttons = [];
  let active = null;
  let hovered = null;
  let pressedOver = false;
  let warnings = null;
  container.classList.add('surfaceos-widgets');

  // Warnings go to the console and, per the contract, are also visible inside the window.
  function report(message, detail) {
    warn(message, detail);
    if (!warnings) {
      warnings = document.createElement('ul');
      warnings.className = 'surfaceos-widget-warnings';
      container.append(warnings);
    }
    const item = document.createElement('li');
    item.textContent = message;
    warnings.append(item);
  }

  function updateStates() {
    for (const button of buttons) {
      const id = button.id;
      button.element.classList.toggle('surfaceos-widget--hover', !active && hovered === id);
      // A held press only looks pressed while the pointer is still over that button.
      button.element.classList.toggle('surfaceos-widget--pressed', active?.widgetId === id && pressedOver);
    }
  }

  function renderLayout(layout) {
    // An invalid layout leaves the previous content in place rather than blanking the window.
    if (!layout || layout.version !== 1 || typeof layout.window_id !== 'string' || !layout.window_id || !Array.isArray(layout.widgets)) {
      report('Invalid SurfaceOS widget layout', layout);
      return false;
    }
    if (current && current.window_id !== layout.window_id) {
      for (const node of nodes.values()) node.element.remove();
      nodes = new Map();
      active = null;
      hovered = null;
    }

    const skipped = [];
    const seen = new Set();
    const next = new Map();
    const ordered = [];
    for (const widget of layout.widgets) {
      if (!widget || typeof widget.id !== 'string' || !widget.id || seen.has(widget.id)) {
        skipped.push(['Skipping widget with missing or duplicate id', widget]);
        continue;
      }
      seen.add(widget.id);
      if (!SUPPORTED.has(widget.type)) {
        skipped.push([`Unsupported widget type: ${String(widget.type)}`, widget]);
        continue;
      }
      if (!validBounds(widget)) {
        skipped.push([`Skipping widget "${widget.id}" with invalid window-local bounds`, widget]);
        continue;
      }
      const { tokens, invalid } = variantTokens(widget.variant);
      if (invalid) skipped.push([`Ignoring invalid variant on widget "${widget.id}"`, widget]);

      const previous = nodes.get(widget.id);
      const element = previous && previous.type === widget.type ? previous.element : createElementFor(widget.type);
      const disabled = widget.type === 'button' && widget.disabled === true;
      const className = [
        'surfaceos-widget',
        `surfaceos-widget--${widget.type}`,
        ...tokens.map((token) => `surfaceos-v-${token}`),
        ...(disabled ? ['surfaceos-widget--disabled'] : []),
      ].join(' ');
      // Keep state classes (hover, pressed) that updateStates manages.
      const stateClasses = [...element.classList].filter((name) => name === 'surfaceos-widget--hover' || name === 'surfaceos-widget--pressed');
      element.className = [className, ...stateClasses].join(' ');
      element.dataset.widgetId = widget.id;
      if (widget.type === 'button' || widget.type === 'text') {
        const text = typeof widget.text === 'string' ? widget.text : '';
        if (element.textContent !== text) element.textContent = text;
      }
      const { x, y, width, height } = widget;
      element.style.left = `${x * 100}%`;
      element.style.top = `${y * 100}%`;
      element.style.width = `${width * 100}%`;
      element.style.height = `${height * 100}%`;
      const node = { id: widget.id, type: widget.type, x, y, width, height, disabled, element };
      next.set(widget.id, node);
      ordered.push(node);
    }

    for (const [id, node] of nodes) {
      if (next.get(id)?.element !== node.element) node.element.remove();
    }
    if (warnings) {
      warnings.remove();
      warnings = null;
    }
    // Reorder only when needed; moving a live video or canvas is harmless but unnecessary.
    const inOrder = ordered.every((node, i) => container.children[i] === node.element) && container.children.length === ordered.length;
    if (!inOrder) container.append(...ordered.map((node) => node.element));

    nodes = next;
    buttons = ordered.filter((node) => node.type === 'button' && !node.disabled);
    current = { window_id: layout.window_id };
    // A press survives a re-render only while its button is still there and enabled.
    if (active && !buttons.some((button) => button.id === active.widgetId)) {
      active = null;
      pressedOver = false;
    }
    if (hovered && !buttons.some((button) => button.id === hovered)) hovered = null;
    for (const node of ordered) {
      if (node.type !== 'button' || node.disabled) {
        node.element.classList.remove('surfaceos-widget--hover', 'surfaceos-widget--pressed');
      }
    }
    updateStates();
    for (const [message, widget] of skipped) report(message, widget);
    return true;
  }

  function buttonAt(x, y) {
    if (!(x >= 0 && y >= 0 && x <= 1 && y <= 1)) return null;
    // Later widgets are drawn on top, so they win overlapping hits.
    for (let i = buttons.length - 1; i >= 0; i -= 1) {
      const b = buttons[i];
      if (x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height) return b;
    }
    return null;
  }

  // Shell calls this only after its own create/move/resize and pointer routing.
  // Coordinates are normalized INSIDE this window. No DOM click handler is used,
  // so a browser's synthetic click cannot trigger a second action.
  // Returns true when the event landed on or activated a button, or canceled a press.
  function handlePointer(event) {
    if (!current || !event || event.version !== 1 || !POINTER_TYPES.includes(event.type)) return false;
    if (event.type === 'pointer_cancel') {
      const hadPress = active !== null;
      active = null;
      hovered = null;
      pressedOver = false;
      updateStates();
      return hadPress;
    }
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return false;
    const hit = buttonAt(event.x, event.y);
    hovered = hit ? hit.id : null;

    if (event.type === 'pointer_down') {
      active = hit ? { windowId: current.window_id, widgetId: hit.id } : null;
      pressedOver = !!hit;
      updateStates();
      return !!hit;
    }
    if (event.type === 'pointer_move') {
      pressedOver = !!active && hit?.id === active.widgetId;
      updateStates();
      return !!hit;
    }
    // pointer_up
    const pressed = active;
    active = null;
    pressedOver = false;
    updateStates();
    if (pressed && hit?.id === pressed.widgetId && pressed.windowId === current.window_id) {
      try {
        onAction({ version: 1, window_id: pressed.windowId, widget_id: pressed.widgetId, event: 'activate' });
      } catch (error) {
        console.error('SurfaceOS widget onAction handler failed', error);
      }
      return true;
    }
    return false;
  }

  // Gives app code the live element of a canvas or video widget so it can draw or attach a stream.
  function getElement(widgetId) {
    return nodes.get(widgetId)?.element ?? null;
  }

  function clear() {
    active = null;
    hovered = null;
    pressedOver = false;
    current = null;
    nodes = new Map();
    buttons = [];
    warnings = null;
    container.replaceChildren();
  }

  return { renderLayout, handlePointer, getElement, clear };
}
